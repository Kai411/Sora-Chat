<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { currentTod } from "../lib/tod";
import type { PublicUser } from "../types";

const props = defineProps<{ users: PublicUser[]; selfId: number }>();
const emit = defineEmits<{ select: [user: PublicUser] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let ro: ResizeObserver | null = null;
let raf = 0;

// ---------------------------------------------------------------------------
// Geometry — reference-style massing: a wide podium at street level, a slim
// main tower rising from it, penthouse + rooftop greenery. 3/4 corner view
// (right side face visible). The ground line is anchored to the viewport
// bottom by the camera clamp, so the city can never float.
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };
type Quad = [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const qp = (q: Quad, u: number, v: number): Pt => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v);

interface Block {
  front: Quad;
  side: Quad;
  roof: Quad;
}

function makeBlock(cx: number, wTop: number, wBot: number, yTop: number, yBot: number, depth: number): Block {
  const dx = depth;
  const dy = depth * 0.36;
  const front: Quad = [
    { x: cx - wTop / 2, y: yTop },
    { x: cx + wTop / 2, y: yTop },
    { x: cx + wBot / 2, y: yBot },
    { x: cx - wBot / 2, y: yBot },
  ];
  const side: Quad = [
    front[1],
    { x: front[1].x + dx, y: front[1].y - dy },
    { x: front[2].x + dx * 0.9, y: front[2].y - dy * 0.85 },
    front[2],
  ];
  const roof: Quad = [
    { x: front[0].x + dx, y: front[0].y - dy },
    { x: front[1].x + dx, y: front[1].y - dy },
    front[1],
    front[0],
  ];
  return { front, side, roof };
}

const CX = 250;
const GROUND = 1040;
const podium = makeBlock(CX, 470, 486, 706, GROUND, 92);
const tower = makeBlock(CX, 322, 344, 64, 714, 62);
const pent = makeBlock(CX + 14, 128, 134, 10, 66, 30);

// window grids -----------------------------------------------------------
interface Win {
  idx: number;
  quad: Quad;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function buildGrid(face: Quad, cols: number, rows: number, mx = 0.07, vTop = 0.05, vBot = 0.95, frac = 0.62): Win[] {
  const out: Win[] = [];
  const cw = (1 - 2 * mx) / cols;
  const rh = (vBot - vTop) / rows;
  const wpad = (cw * (1 - frac)) / 2;
  const hpad = (rh * (1 - frac)) / 2;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const quad: Quad = [
        qp(face, mx + c * cw + wpad, vTop + r * rh + hpad),
        qp(face, mx + (c + 1) * cw - wpad, vTop + r * rh + hpad),
        qp(face, mx + (c + 1) * cw - wpad, vTop + (r + 1) * rh - hpad),
        qp(face, mx + c * cw + wpad, vTop + (r + 1) * rh - hpad),
      ];
      const xs = quad.map((p) => p.x);
      const ys = quad.map((p) => p.y);
      out.push({ idx: i++, quad, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
    }
  }
  return out;
}

const towerWins = buildGrid(tower.front, 6, 16); // user windows live here
const towerSideWins = buildGrid(tower.side, 3, 16, 0.1);
const podiumWins = buildGrid(podium.front, 9, 6, 0.05, 0.08, 0.9);
const podiumSideWins = buildGrid(podium.side, 4, 6, 0.1, 0.08, 0.9);

// deterministic per-window randomness
const h32 = (n: number) => {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};
const rand01 = (n: number) => h32(n) / 0xffffffff;

const ambTower = towerWins.map((w) => rand01(w.idx * 3 + 1) < 0.42);
const ambTowerSide = towerSideWins.map((w) => rand01(w.idx * 7 + 900) < 0.36);
const ambPodium = podiumWins.map((w) => rand01(w.idx * 5 + 300) < 0.5);
const ambPodiumSide = podiumSideWins.map((w) => rand01(w.idx * 11 + 570) < 0.4);

interface Person {
  walk: boolean;
  speed: number;
  phase: number;
  base: number;
}
const persons = new Map<number, Person>();
for (const w of towerWins) {
  if (!ambTower[w.idx]) continue;
  const r = rand01(w.idx * 13 + 77);
  if (r < 0.38) {
    persons.set(w.idx, {
      walk: r < 0.18,
      speed: 0.25 + rand01(w.idx * 5) * 0.35,
      phase: rand01(w.idx * 11) * Math.PI * 2,
      base: 0.3 + rand01(w.idx * 17) * 0.4,
    });
  }
}

let userAt: (PublicUser | null)[] = [];
function assignUsers() {
  userAt = new Array(towerWins.length).fill(null);
  const taken = new Set<number>();
  for (const u of props.users) {
    let slot = Math.abs(u.id * 2654435761) % towerWins.length;
    while (taken.has(slot)) slot = (slot + 1) % towerWins.length;
    taken.add(slot);
    userAt[slot] = u;
  }
}

// neighbor city blocks (world space, behind the hero)
const neighbors = [
  { block: makeBlock(-235, 200, 214, 330, GROUND, 46), cols: 4, rows: 12, salt: 3 },
  { block: makeBlock(-95, 150, 160, 520, GROUND, 34), cols: 3, rows: 9, salt: 7 },
  { block: makeBlock(632, 216, 230, 260, GROUND, 50), cols: 4, rows: 14, salt: 13 },
  { block: makeBlock(760, 150, 158, 470, GROUND, 34), cols: 3, rows: 10, salt: 19 },
];

// ---------------------------------------------------------------------------
// Camera — clamped so the ground line stays glued to the viewport bottom.
// ---------------------------------------------------------------------------
const cam = { x: 0, y: 0, scale: 1 };
let fitScale = 1;
let cssW = 0;
let cssH = 0;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const WORLD = { x0: -360, y0: -170, x1: 850, y1: GROUND };

function clampCam() {
  cam.scale = Math.max(fitScale, Math.min(4, cam.scale));
  // Ground anchored to (or below) the bottom edge — the city can't float up…
  const minY = cssH - GROUND * cam.scale;
  // …and can't be dragged so far down that the skyline sinks out of view.
  const maxY = cssH * 0.6 - WORLD.y0 * cam.scale;
  cam.y = Math.min(Math.max(cam.y, minY), Math.max(maxY, minY));
  // Horizontally the hero tower must stay within reach.
  const minX = cssW * 0.4 - (CX + 420) * cam.scale;
  const maxX = cssW * 0.6 + (420 - CX) * cam.scale;
  cam.x = Math.min(Math.max(cam.x, minX), maxX);
}

function fit() {
  fitScale = Math.min((cssH * 0.98) / (GROUND - WORLD.y0), (cssW - 8) / 700);
  cam.scale = fitScale;
  cam.x = cssW / 2 - (CX + 40) * cam.scale;
  cam.y = cssH - GROUND * cam.scale;
  clampCam();
}

// ---------------------------------------------------------------------------
// Painting helpers
// ---------------------------------------------------------------------------
function pathQuad(g: CanvasRenderingContext2D, q: Quad) {
  g.beginPath();
  g.moveTo(q[0].x, q[0].y);
  g.lineTo(q[1].x, q[1].y);
  g.lineTo(q[2].x, q[2].y);
  g.lineTo(q[3].x, q[3].y);
  g.closePath();
}

function subQuad(face: Quad, u0: number, v0: number, u1: number, v1: number): Quad {
  return [qp(face, u0, v0), qp(face, u1, v0), qp(face, u1, v1), qp(face, u0, v1)];
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${gg},${b})`;
}
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawPerson(g: CanvasRenderingContext2D, w: Win, px: number, sway: number) {
  const top = qp(w.quad, px, 0.16);
  const bot = qp(w.quad, px, 1);
  const h = Math.hypot(bot.x - top.x, bot.y - top.y);
  const bw = (w.maxX - w.minX) * 0.24;
  g.save();
  g.translate(bot.x + sway * bw * 0.3, bot.y);
  g.fillStyle = "rgba(10,11,20,0.88)";
  g.beginPath();
  g.moveTo(-bw / 2, 0);
  g.quadraticCurveTo(-bw / 2 - bw * 0.08, -h * 0.55, -bw * 0.28, -h * 0.66);
  g.quadraticCurveTo(0, -h * 0.74, bw * 0.28, -h * 0.66);
  g.quadraticCurveTo(bw / 2 + bw * 0.08, -h * 0.55, bw / 2, 0);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(0, -h * 0.8, h * 0.12, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawTrees(g: CanvasRenderingContext2D, roof: Quad, spots: [number, number, number][]) {
  for (const [u, v, r] of spots) {
    const c = qp(roof, u, v);
    g.fillStyle = "#1d3322";
    g.beginPath();
    g.ellipse(c.x, c.y - r * 0.4, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#264a2c";
    g.beginPath();
    g.ellipse(c.x - r * 0.3, c.y - r * 0.55, r * 0.6, r * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
let phase = 0;

function render(t: number) {
  const c = canvas.value;
  if (!c || !ctx || !cssW || !cssH) return;
  const g = ctx;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const needW = Math.round(cssW * dpr);
  const needH = Math.round(cssH * dpr);
  if (c.width !== needW || c.height !== needH) {
    c.width = needW;
    c.height = needH;
  }
  const p = currentTod();
  const night = p.star > 0.2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // sky
  const sky = g.createLinearGradient(0, 0, 0, cssH);
  sky.addColorStop(0, p.skyTop);
  sky.addColorStop(1, p.skyBottom);
  g.fillStyle = sky;
  g.fillRect(0, 0, cssW, cssH);

  // stars
  if (p.star > 0) {
    for (let i = 0; i < 110; i++) {
      const sx = (((i * 73) % 101) / 101) * cssW;
      const sy = (((i * 131) % 97) / 97) * cssH * 0.6;
      const tw = 0.55 + 0.45 * Math.sin(t * 0.0006 + i * 1.7);
      g.globalAlpha = p.star * tw * (0.35 + ((i * 29) % 60) / 90);
      g.fillStyle = "#fff";
      g.fillRect(sx, sy, i % 9 === 0 ? 2 : 1.3, i % 9 === 0 ? 2 : 1.3);
    }
    g.globalAlpha = 1;
  }

  // moon
  if (night) {
    const mx = cssW * 0.82;
    const my = cssH * 0.12;
    const mr = Math.min(cssW, cssH) * 0.045;
    const glow = g.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 5);
    glow.addColorStop(0, "rgba(255,244,214,0.35)");
    glow.addColorStop(1, "rgba(255,244,214,0)");
    g.fillStyle = glow;
    g.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    g.fillStyle = "#f6ecd4";
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = p.skyTop;
    g.beginPath();
    g.arc(mx - mr * 0.45, my - mr * 0.22, mr * 0.86, 0, Math.PI * 2);
    g.fill();
  }

  // clouds
  g.globalAlpha = night ? 0.05 : 0.1;
  for (let i = 0; i < 3; i++) {
    const cx2 = ((t * 0.004 + i * 420) % (cssW + 360)) - 180;
    const cy = cssH * (0.1 + i * 0.08);
    const grad = g.createRadialGradient(cx2, cy, 0, cx2, cy, 130);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(cx2 - 140, cy - 60, 280, 120);
  }
  g.globalAlpha = 1;

  // far skyline (screen space, hugs the bottom)
  g.fillStyle = p.silhouette;
  g.globalAlpha = 0.5;
  for (let i = 0; i < 16; i++) {
    const bw = 22 + ((i * 37) % 34);
    const bx = (i * cssW) / 14 - 24;
    const bh = 60 + ((i * 53) % 150);
    g.fillRect(bx, cssH - bh, bw, bh);
  }
  g.globalAlpha = 1;

  // ---- world space ----
  g.save();
  g.translate(cam.x, cam.y);
  g.scale(cam.scale, cam.scale);

  // neighbor towers
  for (const n of neighbors) drawNeighbor(g, p, n, night, t);

  // street haze behind hero base
  const hz0 = g.createLinearGradient(0, GROUND - 260, 0, GROUND);
  hz0.addColorStop(0, hexA(p.skyBottom, 0));
  hz0.addColorStop(1, hexA(p.skyBottom, 0.55));
  g.fillStyle = hz0;
  g.fillRect(WORLD.x0, GROUND - 260, WORLD.x1 - WORLD.x0, 260);

  // ===== hero: podium =====
  drawFace(g, p, podium.side, -16);
  windowsPass(g, p, podiumSideWins, ambPodiumSide, null, t, night, 0.55);
  drawRoof(g, p, podium.roof);
  drawTrees(g, podium.roof, [
    [0.08, 0.5, 13],
    [0.16, 0.3, 10],
    [0.9, 0.45, 12],
    [0.82, 0.65, 9],
  ]);
  drawFace(g, p, podium.front, 0);
  facadeLines(g, podium.front, 9, 6, 0.05, 0.08, 0.9);
  windowsPass(g, p, podiumWins, ambPodium, null, t, night, 0.8);
  // lobby entrance
  const lobby = subQuad(podium.front, 0.38, 0.9, 0.62, 0.995);
  const lgr = g.createLinearGradient(0, qp(podium.front, 0.5, 0.9).y, 0, GROUND);
  lgr.addColorStop(0, hexA("#ffd889", 0.9));
  lgr.addColorStop(1, hexA("#ffb14e", 0.45));
  pathQuad(g, lobby);
  g.fillStyle = lgr;
  g.fill();

  // ===== hero: main tower =====
  drawFace(g, p, tower.side, -14);
  windowsPass(g, p, towerSideWins, ambTowerSide, null, t, night, 0.6);
  drawRoof(g, p, tower.roof);
  drawTrees(g, tower.roof, [
    [0.12, 0.45, 10],
    [0.2, 0.62, 8],
  ]);
  drawFace(g, p, tower.front, 0);
  facadeLines(g, tower.front, 6, 16, 0.07, 0.05, 0.95);
  windowsPass(g, p, towerWins, ambTower, userAt, t, night, 1);

  // corner rim light
  g.strokeStyle = night ? "rgba(255,240,200,0.22)" : "rgba(255,255,255,0.18)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(tower.front[1].x, tower.front[1].y);
  g.lineTo(tower.front[2].x, tower.front[2].y);
  g.stroke();

  // ===== penthouse + antenna =====
  drawFace(g, p, pent.side, -12);
  drawRoof(g, p, pent.roof);
  drawFace(g, p, pent.front, 4);
  const pw = subQuad(pent.front, 0.12, 0.25, 0.88, 0.8);
  pathQuad(g, pw);
  g.fillStyle = hexA(p.windowUser, night ? 0.75 : 0.5);
  g.fill();
  const ant = qp(pent.roof, 0.5, 0.4);
  g.strokeStyle = "rgba(200,210,230,0.5)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(ant.x, ant.y);
  g.lineTo(ant.x, ant.y - 84);
  g.stroke();
  g.fillStyle = `rgba(255,70,70,${0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.003))})`;
  g.beginPath();
  g.arc(ant.x, ant.y - 88, 3.2, 0, Math.PI * 2);
  g.fill();

  // street-level glow
  const street = g.createLinearGradient(0, GROUND - 40, 0, GROUND);
  street.addColorStop(0, hexA(p.skyBottom, 0));
  street.addColorStop(1, hexA(p.skyBottom, 0.75));
  g.fillStyle = street;
  g.fillRect(WORLD.x0, GROUND - 40, WORLD.x1 - WORLD.x0, 40);

  g.restore();

  // vignette
  const vg = g.createRadialGradient(cssW / 2, cssH * 0.45, Math.min(cssW, cssH) * 0.5, cssW / 2, cssH * 0.5, Math.max(cssW, cssH) * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = vg;
  g.fillRect(0, 0, cssW, cssH);
}

function drawFace(g: CanvasRenderingContext2D, p: ReturnType<typeof currentTod>, q: Quad, tone: number) {
  const grad = g.createLinearGradient(0, q[0].y, 0, q[3].y);
  grad.addColorStop(0, shade(p.building, 8 + tone));
  grad.addColorStop(0.6, shade(p.building, tone));
  grad.addColorStop(1, shade(p.buildingShade, tone - 4));
  pathQuad(g, q);
  g.fillStyle = grad;
  g.fill();
}

function drawRoof(g: CanvasRenderingContext2D, p: ReturnType<typeof currentTod>, q: Quad) {
  const grad = g.createLinearGradient(0, q[0].y, 0, q[3].y);
  grad.addColorStop(0, shade(p.buildingRoof, 10));
  grad.addColorStop(1, p.buildingRoof);
  pathQuad(g, q);
  g.fillStyle = grad;
  g.fill();
  pathQuad(g, q);
  g.strokeStyle = "rgba(255,255,255,0.15)";
  g.lineWidth = 1.6;
  g.stroke();
}

function facadeLines(
  g: CanvasRenderingContext2D,
  face: Quad,
  cols: number,
  rows: number,
  mx: number,
  vTop: number,
  vBot: number
) {
  const cw = (1 - 2 * mx) / cols;
  g.fillStyle = "rgba(0,0,0,0.15)";
  for (let cI = 0; cI <= cols; cI++) {
    const u = mx + cI * cw;
    pathQuad(g, subQuad(face, u - 0.005, vTop - 0.01, u + 0.005, vBot + 0.01));
    g.fill();
  }
  g.strokeStyle = "rgba(0,0,0,0.1)";
  g.lineWidth = 2;
  const rh = (vBot - vTop) / rows;
  for (let rI = 0; rI <= rows; rI++) {
    const a = qp(face, mx * 0.4, vTop + rI * rh);
    const b = qp(face, 1 - mx * 0.4, vTop + rI * rh);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
}

function windowsPass(
  g: CanvasRenderingContext2D,
  p: ReturnType<typeof currentTod>,
  wins: Win[],
  ambient: boolean[],
  users: (PublicUser | null)[] | null,
  t: number,
  night: boolean,
  intensity: number
) {
  for (const w of wins) {
    const user = users?.[w.idx] ?? null;
    const q = w.quad;
    if (user) {
      const cx = (w.minX + w.maxX) / 2;
      const cy = (w.minY + w.maxY) / 2;
      const rad = (w.maxX - w.minX) * 1.7;
      const halo = g.createRadialGradient(cx, cy, 2, cx, cy, rad);
      halo.addColorStop(0, hexA(p.windowGlow, 0.5));
      halo.addColorStop(1, hexA(p.windowGlow, 0));
      g.fillStyle = halo;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      const gl = g.createLinearGradient(q[0].x, q[0].y, q[3].x, q[3].y);
      gl.addColorStop(0, "#fff3cf");
      gl.addColorStop(1, p.windowUser);
      pathQuad(g, q);
      g.fillStyle = gl;
      g.fill();
      const pxu = 0.5 + 0.28 * Math.sin(t * 0.00045 + w.idx);
      drawPerson(g, w, pxu, Math.sin(t * 0.002 + w.idx));
      pathQuad(g, q);
      g.strokeStyle = "rgba(255,255,255,0.75)";
      g.lineWidth = 1.6;
      g.stroke();
    } else if (ambient[w.idx]) {
      const warm = rand01(w.idx * 23) > 0.35;
      const glass = g.createLinearGradient(q[0].x, q[0].y, q[3].x, q[3].y);
      glass.addColorStop(0, warm ? "#e8d9ac" : "#cfd9e6");
      glass.addColorStop(1, warm ? "#c8a95f" : "#93a5bd");
      pathQuad(g, q);
      g.fillStyle = glass;
      g.globalAlpha = ((night ? 0.52 : 0.4) + 0.06 * Math.sin(t * 0.0005 + w.idx * 2.1)) * intensity;
      g.fill();
      g.globalAlpha = 1;
      if (rand01(w.idx * 31) < 0.3) {
        g.fillStyle = "rgba(40,40,60,0.35)";
        pathQuad(g, [q[0], lerp(q[0], q[1], 0.35), lerp(q[3], q[2], 0.35), q[3]]);
        g.fill();
      }
      if (users) {
        const person = persons.get(w.idx);
        if (person) {
          const px = person.walk ? 0.5 + 0.3 * Math.sin(t * 0.001 * person.speed + person.phase) : person.base;
          drawPerson(g, w, px, person.walk ? 0 : Math.sin(t * 0.0012 + person.phase) * 0.6);
        }
      }
    } else {
      const refl = g.createLinearGradient(q[0].x, q[0].y, q[2].x, q[2].y);
      refl.addColorStop(0, shade(p.windowDark, 14));
      refl.addColorStop(0.45, p.windowDark);
      refl.addColorStop(1, shade(p.windowDark, -8));
      pathQuad(g, q);
      g.fillStyle = refl;
      g.fill();
    }
    const mid0 = lerp(q[0], q[1], 0.5);
    const mid1 = lerp(q[3], q[2], 0.5);
    g.strokeStyle = "rgba(0,0,0,0.2)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(mid0.x, mid0.y);
    g.lineTo(mid1.x, mid1.y);
    g.stroke();
    pathQuad(g, q);
    g.strokeStyle = "rgba(0,0,0,0.32)";
    g.lineWidth = 1;
    g.stroke();
    g.globalAlpha = 0.06;
    g.fillStyle = "#ffffff";
    pathQuad(g, [lerp(q[0], q[1], 0.05), lerp(q[0], q[1], 0.45), lerp(q[3], q[2], 0.25), lerp(q[3], q[2], 0.0)]);
    g.fill();
    g.globalAlpha = 1;
  }
}

function drawNeighbor(
  g: CanvasRenderingContext2D,
  p: ReturnType<typeof currentTod>,
  n: { block: Block; cols: number; rows: number; salt: number },
  night: boolean,
  t: number
) {
  g.save();
  g.globalAlpha = 0.85;
  const { front, side, roof } = n.block;
  pathQuad(g, side);
  g.fillStyle = shade(p.silhouette, -16);
  g.fill();
  pathQuad(g, roof);
  g.fillStyle = shade(p.silhouette, -2);
  g.fill();
  const grad = g.createLinearGradient(0, front[0].y, 0, front[3].y);
  grad.addColorStop(0, shade(p.silhouette, -4));
  grad.addColorStop(1, shade(p.silhouette, -20));
  pathQuad(g, front);
  g.fillStyle = grad;
  g.fill();
  for (let r = 0; r < n.rows; r++) {
    for (let c = 0; c < n.cols; c++) {
      const u0 = 0.1 + (c * 0.8) / n.cols;
      const v0 = 0.04 + (r * 0.9) / n.rows;
      pathQuad(g, subQuad(front, u0, v0, u0 + 0.52 / n.cols, v0 + 0.55 / n.rows));
      const lit = (c * 31 + r * 17 + n.salt * 7) % 11 < (night ? 3 : 2);
      g.fillStyle = lit
        ? `rgba(255,214,140,${0.5 + 0.08 * Math.sin(t * 0.0006 + r + c + n.salt)})`
        : "rgba(0,0,0,0.3)";
      g.fill();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
const pointers = new Map<number, Pt>();
let last: Pt = { x: 0, y: 0 };
let pinchDist = 0;
let downAt = { x: 0, y: 0, t: 0 };
let moved = 0;

const screenToWorld = (sx: number, sy: number): Pt => ({ x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale });

function localPoint(e: { clientX: number; clientY: number }): Pt {
  const rect = canvas.value!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onDown(e: PointerEvent) {
  canvas.value!.setPointerCapture(e.pointerId);
  const pt = localPoint(e);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1) {
    last = pt;
    downAt = { ...pt, t: Date.now() };
    moved = 0;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}

function onMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  const pt = localPoint(e);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1) {
    cam.x += pt.x - last.x;
    cam.y += pt.y - last.y;
    moved += Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y);
    last = pt;
    clampCam();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) zoomAround((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist);
    pinchDist = dist;
    moved += 20;
  }
}

function onUp(e: PointerEvent) {
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  if (wasSingle && moved < 8 && Date.now() - downAt.t < 400) hitTest(downAt.x, downAt.y);
  if (pointers.size < 2) pinchDist = 0;
}

function zoomAround(sx: number, sy: number, factor: number) {
  const next = Math.max(fitScale, Math.min(4, cam.scale * factor));
  const k = next / cam.scale;
  cam.x = sx - (sx - cam.x) * k;
  cam.y = sy - (sy - cam.y) * k;
  cam.scale = next;
  clampCam();
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const pt = localPoint(e);
  zoomAround(pt.x, pt.y, e.deltaY < 0 ? 1.12 : 0.89);
}

function hitTest(sx: number, sy: number) {
  const w = screenToWorld(sx, sy);
  for (const win of towerWins) {
    const user = userAt[win.idx];
    if (!user) continue;
    const padX = (win.maxX - win.minX) * 0.3;
    const padY = (win.maxY - win.minY) * 0.3;
    if (w.x >= win.minX - padX && w.x <= win.maxX + padX && w.y >= win.minY - padY && w.y <= win.maxY + padY) {
      emit("select", user);
      return;
    }
  }
}

function zoomBy(factor: number) {
  zoomAround(cssW / 2, cssH / 2, factor);
}
function recenter() {
  fit();
}
defineExpose({ zoomBy, recenter });

// ---------------------------------------------------------------------------
// Lifecycle — ~30fps loop; static under prefers-reduced-motion.
// ---------------------------------------------------------------------------
let lastFrame = 0;
function loop(t: number) {
  raf = requestAnimationFrame(loop);
  if (document.hidden) return;
  if (t - lastFrame < 33) return;
  lastFrame = t;
  phase = t;
  render(t);
}

function measure() {
  const c = canvas.value!;
  cssW = c.clientWidth;
  cssH = c.clientHeight;
}

watch(
  () => props.users.map((u) => u.id).join(","),
  () => {
    assignUsers();
    if (reduceMotion) render(phase);
  }
);

onMounted(() => {
  const c = canvas.value!;
  ctx = c.getContext("2d");
  measure();
  assignUsers();
  fit();
  ro = new ResizeObserver(() => {
    const hadSize = cssW > 0;
    measure();
    if (!hadSize) fit();
    else clampCam();
    if (reduceMotion) render(phase);
  });
  ro.observe(c);
  if (reduceMotion) render(0);
  else raf = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  cancelAnimationFrame(raf);
});
</script>

<template>
  <canvas
    ref="canvas"
    class="size-full touch-none select-none"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @wheel="onWheel"
  ></canvas>
</template>
