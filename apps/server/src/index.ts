import "./env";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { basename, extname, join } from "node:path";
import { Server, type Socket } from "socket.io";
import { AccessToken } from "livekit-server-sdk";
import { db, getUserById, publicUser, type UserRow } from "./db";
import { verifySupabaseToken } from "./auth";
import { startSnapshotLoop, uploadMedia } from "./persist";

const PORT = Number(process.env.PORT) || 3001;
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

// TEMPORARY admin credentials — override via env, replace with real auth later.
const ADMIN_ID = process.env.ADMIN_ID ?? "0001";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "test12345678!";
const adminTokens = new Set<string>();
const isAdmin = (token: any) => typeof token === "string" && adminTokens.has(token);

// ---------------------------------------------------------------------------
// Live (non-persisted) state: presence, party rooms, matchmaking, calls.
// ---------------------------------------------------------------------------

const online = new Map<string, number>(); // socketId -> userId

const ROOM_CATEGORIES = ["music", "private", "chat"] as const;
type RoomCategory = (typeof ROOM_CATEGORIES)[number];

const SEAT_COUNT = 10; // rendered as 2 rows × 5 columns
const CATEGORY_ICONS: Record<RoomCategory, string> = { music: "🎵", private: "🥂", chat: "💬" };

interface SeatState {
  userId: number;
  muted: boolean; // self-mute
  blocked: boolean; // force-muted by host/admin
}

type SeatLayout = "grid" | "couple";

interface LiveRoom {
  id: string;
  name: string;
  icon: string;
  topic: string;
  category: RoomCategory;
  pin: string | null;
  hostId: number;
  creator: ReturnType<typeof publicUser>;
  seats: (SeatState | null)[];
  admins: number[]; // max 2
  requests: Map<number, number>; // userId -> wanted seat index
  invites: Map<number, number>; // userId -> offered seat index
  banned: Set<number>; // kicked users can't re-enter
  disabled: Set<number>; // muted + typing blocked by a moderator
  layout: SeatLayout;
  background: string | null; // preset background image path
  music: RoomMusic | null;
}

interface RoomMusic {
  trackId: number;
  src: string;
  name: string;
  ownerId: number;
  ownerName: string;
  playing: boolean;
  startedAt: number; // epoch ms when (re)started
  offset: number; // seconds already played before startedAt
}

interface RoomMsg {
  id: number;
  userId: number;
  author: string;
  avatar: string;
  frame: string | null;
  text: string;
  ts: number;
  system?: boolean;
}

const rooms = new Map<string, LiveRoom>();
const roomMessages = new Map<string, RoomMsg[]>();
let roomMsgSeq = 1;

type Mode = "chat" | "call";
const queues: Record<Mode, string[]> = { chat: [], call: [] };

interface CallSession {
  mode: Mode | "dm";
  peers: string[]; // socket ids
  inviterUserId?: number;
  calleeUserId?: number;
}
const sessions = new Map<string, CallSession>();

// ---------------------------------------------------------------------------
// Gacha banners
// ---------------------------------------------------------------------------

type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";
type Pool = Record<Rarity, { name: string; icon: string }[]>;

const GENESIS_POOL: Pool = {
  common: [
    { name: "Bubble Frame", icon: "🫧" },
    { name: "Leaf Badge", icon: "🍃" },
    { name: "Coffee Sticker", icon: "☕" },
    { name: "Paw Print", icon: "🐾" },
    { name: "Paper Plane", icon: "✈️" },
  ],
  rare: [
    { name: "Neon Frame", icon: "💜" },
    { name: "Star Trail", icon: "🌠" },
    { name: "Vinyl Entrance", icon: "📀" },
  ],
  epic: [
    { name: "Galaxy Aura", icon: "🌌" },
    { name: "Phoenix Ring", icon: "🔥" },
    { name: "Crystal Crown", icon: "👑" },
  ],
  legendary: [
    { name: "Dragon Companion", icon: "🐉" },
    { name: "Aurora Halo", icon: "🌈" },
  ],
  mythic: [{ name: "Sora Genesis Wings", icon: "🪽" }],
};

const MIDNIGHT_POOL: Pool = {
  common: [
    { name: "Star Sticker", icon: "⭐" },
    { name: "Cloud Badge", icon: "☁️" },
    { name: "Lantern Frame", icon: "🏮" },
    { name: "Dewdrop", icon: "💧" },
    { name: "Night Breeze", icon: "🌫️" },
  ],
  rare: [
    { name: "Owl Familiar", icon: "🦉" },
    { name: "Moonbeam Trail", icon: "🌙" },
    { name: "Firefly Jar", icon: "🫙" },
  ],
  epic: [
    { name: "Eclipse Aura", icon: "🌒" },
    { name: "Wolf Spirit", icon: "🐺" },
    { name: "Starfall Crown", icon: "🌠" },
  ],
  legendary: [
    { name: "Midnight Carriage", icon: "🎠" },
    { name: "Comet Halo", icon: "☄️" },
  ],
  mythic: [{ name: "Queen of the Night", icon: "🌹" }],
};

const BANNERS = [
  {
    id: "genesis",
    name: "Genesis Wings",
    icon: "🪽",
    tagline: "The founding banner — pull the Mythic entrance effect",
    theme: "from-violet-600 via-fuchsia-600 to-pink-500",
    pool: GENESIS_POOL,
  },
  {
    id: "midnight",
    name: "Midnight Parade",
    icon: "🌹",
    tagline: "Nocturnal companions, auras & the Queen herself",
    theme: "from-indigo-700 via-blue-600 to-cyan-500",
    pool: MIDNIGHT_POOL,
  },
];

// Published pull rates — store policy requires disclosing these in-app.
const GACHA_RATES: [Rarity, number][] = [
  ["mythic", 0.005],
  ["legendary", 0.045],
  ["epic", 0.1],
  ["rare", 0.25],
  ["common", 0.6],
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollOnce(pool: Pool, minRarity?: Rarity) {
  const roll = Math.random();
  let acc = 0;
  let rarity: Rarity = "common";
  for (const [r, rate] of GACHA_RATES) {
    acc += rate;
    if (roll < acc) {
      rarity = r;
      break;
    }
  }
  if (minRarity === "rare" && rarity === "common") rarity = "rare";
  return { rarity, ...pick(pool[rarity]) };
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const setCoins = db.prepare("UPDATE users SET coins = ? WHERE id = ?");
const setVip = db.prepare("UPDATE users SET vip = 1 WHERE id = ?");
const setDaily = db.prepare("UPDATE users SET last_daily = ?, coins = ? WHERE id = ?");
const addInventory = db.prepare("INSERT INTO inventory (user_id, name, icon, rarity) VALUES (?, ?, ?, ?)");
const listInventory = db.prepare("SELECT name, icon, rarity FROM inventory WHERE user_id = ?");

const insertPost = db.prepare("INSERT INTO posts (user_id, text, image, ts) VALUES (?, ?, ?, ?)");
const likeStmt = db.prepare("INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)");
const unlikeStmt = db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?");
const hasLike = db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?");
const followStmt = db.prepare("INSERT OR IGNORE INTO follows (follower, followee) VALUES (?, ?)");
const unfollowStmt = db.prepare("DELETE FROM follows WHERE follower = ? AND followee = ?");
const hasFollow = db.prepare("SELECT 1 FROM follows WHERE follower = ? AND followee = ?");

const FEED_SELECT = `
  SELECT p.id, p.text, p.image, p.ts, p.user_id AS userId, u.nickname AS author, u.avatar, u.frame AS authorFrame,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @viewer) AS liked,
    EXISTS(SELECT 1 FROM follows f WHERE f.follower = @viewer AND f.followee = p.user_id) AS following
  FROM posts p JOIN users u ON u.id = p.user_id`;
const feedPublic = db.prepare(`${FEED_SELECT} ORDER BY p.ts DESC LIMIT 100`);
const feedFollowing = db.prepare(
  `${FEED_SELECT} WHERE EXISTS(SELECT 1 FROM follows f WHERE f.follower = @viewer AND f.followee = p.user_id)
   ORDER BY p.ts DESC LIMIT 100`
);
const feedByUser = db.prepare(`${FEED_SELECT} WHERE p.user_id = @target ORDER BY p.ts DESC LIMIT 100`);
const getPostRow = db.prepare(`${FEED_SELECT} WHERE p.id = @id`);

const insertComment = db.prepare("INSERT INTO comments (post_id, user_id, text, ts) VALUES (?, ?, ?, ?)");
const listComments = db.prepare(
  `SELECT c.id, c.text, c.ts, c.user_id AS userId, u.nickname AS author, u.avatar, u.frame
   FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.ts LIMIT 200`
);
const countComments = db.prepare<[number], { c: number }>("SELECT COUNT(*) c FROM comments WHERE post_id = ?");

// Preset profile pictures — image files live in apps/web/public/avatars/ as
// <id>.<ext> (a01 … a12), any of png/jpg/jpeg/webp. No custom uploads; bought
// with coins. The extension for each slot is resolved from disk at startup so
// you can drop in whichever format you have.
const ALLOWED_AVATAR_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Cosmetics shop — five categories. The catalog lives entirely in the db and
// is managed through the admin panel (/admin): it starts EMPTY, no folder
// seeding, so staging only ever shows what an admin explicitly uploaded.
type ShopType = "avatar" | "frame" | "background" | "bubble" | "pet";
const SHOP_TYPES: ShopType[] = ["avatar", "frame", "background", "bubble", "pet"];
// which users column stores each equipped item
const EQUIP_COL: Record<ShopType, "avatar" | "frame" | "profile_bg" | "bubble" | "pet"> = {
  avatar: "avatar",
  frame: "frame",
  background: "profile_bg",
  bubble: "bubble",
  pet: "pet",
};
const isShopType = (t: any): t is ShopType => SHOP_TYPES.includes(t);

interface ShopItem {
  id: number;
  type: ShopType;
  name: string;
  price: number;
  src: string;
}
const insertShopItem = db.prepare(
  "INSERT INTO shop_items (type, name, price, src, created) VALUES (?, ?, ?, ?, ?)"
);
const itemsByType = db.prepare<[string], ShopItem>("SELECT id, type, name, price, src FROM shop_items WHERE type = ? ORDER BY id");
const allShopItems = db.prepare<[], ShopItem>("SELECT id, type, name, price, src FROM shop_items ORDER BY type, id");

function catalogFor(type: ShopType): { src: string; price: number; name: string }[] {
  return (itemsByType.all(type) as ShopItem[]).map((it) => ({ src: it.src, price: it.price, name: it.name }));
}

const ownedCosmetics = db.prepare<[number, string], { src: string }>(
  "SELECT src FROM cosmetics_owned WHERE user_id = ? AND type = ?"
);
const addCosmetic = db.prepare<[number, string, string]>(
  "INSERT OR IGNORE INTO cosmetics_owned (user_id, type, src) VALUES (?, ?, ?)"
);
const EQUIP_STMT: Record<ShopType, { run: (v: string | null, id: number) => unknown }> = Object.fromEntries(
  SHOP_TYPES.map((t) => [t, db.prepare(`UPDATE users SET ${EQUIP_COL[t]} = ? WHERE id = ?`)])
) as any;

function equippedOf(u: UserRow, type: ShopType): string | null {
  return (u as any)[EQUIP_COL[type]] ?? null;
}
// avatar/frame/pet show up on other people's screens, so re-push presence + rooms.
function afterEquip(userId: number) {
  broadcastPresence();
  rebroadcastUserRooms(userId);
}

const recordVisit = db.prepare("INSERT OR REPLACE INTO visits (visitor, visited, ts) VALUES (?, ?, ?)");
const listVisitors = db.prepare("SELECT visitor AS uid, ts FROM visits WHERE visited = ? ORDER BY ts DESC LIMIT 50");
const listVisited = db.prepare("SELECT visited AS uid, ts FROM visits WHERE visitor = ? ORDER BY ts DESC LIMIT 50");
const followerCount = db.prepare<[number], { c: number }>("SELECT COUNT(*) c FROM follows WHERE followee = ?");
const followingCount = db.prepare<[number], { c: number }>("SELECT COUNT(*) c FROM follows WHERE follower = ?");
const postCount = db.prepare<[number], { c: number }>("SELECT COUNT(*) c FROM posts WHERE user_id = ?");
const listFollowers = db.prepare("SELECT follower AS uid FROM follows WHERE followee = ? LIMIT 100");
const listFollowing = db.prepare("SELECT followee AS uid FROM follows WHERE follower = ? LIMIT 100");

const insertDm = db.prepare("INSERT INTO dms (sender, recipient, text, ts) VALUES (?, ?, ?, ?)");
const dmHistory = db.prepare(
  `SELECT id, sender, text, ts FROM dms
   WHERE (sender = @a AND recipient = @b) OR (sender = @b AND recipient = @a)
   ORDER BY ts DESC LIMIT 200`
);
const dmMarkRead = db.prepare("UPDATE dms SET read = 1 WHERE sender = ? AND recipient = ? AND read = 0");
const dmRecent = db.prepare(
  "SELECT id, sender, recipient, text, ts, read FROM dms WHERE sender = ? OR recipient = ? ORDER BY ts DESC LIMIT 1000"
);

function serializeFeedRow(row: any, viewerId: number) {
  return { ...row, liked: !!row.liked, following: !!row.following, mine: row.userId === viewerId };
}

// ---------------------------------------------------------------------------
// Image uploads (served from /uploads; ephemeral on Render's free disk)
// ---------------------------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" };
const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
const ASSET_TYPES: Record<string, string> = { ...IMAGE_TYPES, ...AUDIO_TYPES };
const MAX_MUSIC_BYTES = 15_000_000;

const nextMusicPosition = db.prepare<[number], { m: number | null }>(
  "SELECT MAX(position) m FROM music WHERE user_id = ?"
);
const insertMusic = db.prepare("INSERT INTO music (user_id, name, src, position, created) VALUES (?, ?, ?, ?, ?)");
const listMusic = db.prepare<[number], { id: number; name: string; src: string }>(
  "SELECT id, name, src FROM music WHERE user_id = ? ORDER BY position, id"
);
const getMusic = db.prepare<[number], { id: number; user_id: number; name: string; src: string }>(
  "SELECT id, user_id, name, src FROM music WHERE id = ?"
);
const setMusicPosition = db.prepare("UPDATE music SET position = ? WHERE id = ? AND user_id = ?");
const MAX_IMAGE_BYTES = 2_000_000;

async function saveDataUrlImage(dataUrl: string): Promise<string | null> {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  const ext = m[1] === "jpg" ? "jpeg" : m[1];
  const file = `${randomUUID()}.${ext}`;
  // Prefer Supabase Storage (survives redeploys); fall back to local disk.
  const url = await uploadMedia(`img/${file}`, buf, IMAGE_TYPES[ext]);
  if (url) return url;
  writeFileSync(join(UPLOAD_DIR, file), buf);
  return `/uploads/${file}`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  // CORS: the SPA on Netlify calls the upload endpoint cross-origin.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, x-filename, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, online: online.size }));
    return;
  }
  if (req.url?.startsWith("/uploads/")) {
    const file = basename(req.url); // strips any path tricks
    const type = ASSET_TYPES[extname(file).slice(1).toLowerCase()];
    const path = join(UPLOAD_DIR, file);
    if (!type || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
    createReadStream(path).pipe(res);
    return;
  }
  // Music upload: raw file body, filename in x-filename, Supabase token in
  // Authorization. Files persist in the user's library (music table).
  if (req.url === "/music" && req.method === "POST") {
    const fail = (code: number, error: string) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ error }));
    };
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    let filename = "track";
    try {
      filename = decodeURIComponent(String(req.headers["x-filename"] ?? "track"));
    } catch {
      /* keep default */
    }
    const ext = extname(filename).slice(1).toLowerCase();
    if (!AUDIO_TYPES[ext]) return fail(400, "Use MP3, M4A, AAC, OGG or WAV");
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_MUSIC_BYTES) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", async () => {
      if (size === 0 || size > MAX_MUSIC_BYTES) return fail(400, "File must be under 15 MB");
      const auth = await verifySupabaseToken(token);
      if ("error" in auth) return fail(401, auth.error);
      const file = `${randomUUID()}.${ext}`;
      const buf = Buffer.concat(chunks);
      // Prefer Supabase Storage (survives redeploys); fall back to local disk.
      let src = await uploadMedia(`music/${file}`, buf, AUDIO_TYPES[ext]);
      if (!src) {
        writeFileSync(join(UPLOAD_DIR, file), buf);
        src = `/uploads/${file}`;
      }
      const name = basename(filename, extname(filename)).slice(0, 60) || "Track";
      const nextPos = (nextMusicPosition.get(auth.user.id)?.m ?? -1) + 1;
      const info = insertMusic.run(auth.user.id, name, src, nextPos, Date.now());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: Number(info.lastInsertRowid), name, src }));
    });
    return;
  }
  res.writeHead(404).end();
});

const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 3e6 });

function userSockets(userId: number): string[] {
  return [...online.entries()].filter(([, uid]) => uid === userId).map(([sid]) => sid);
}

function broadcastPresence() {
  const seen = new Set<number>();
  const users: any[] = [];
  for (const userId of online.values()) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    const u = getUserById.get(userId);
    if (u) users.push(publicUser(u));
  }
  io.emit("presence", users);
}

function roomMembers(roomId: string) {
  const ids = io.sockets.adapter.rooms.get(`room:${roomId}`) ?? new Set<string>();
  const seen = new Set<number>();
  const members: any[] = [];
  for (const sid of ids) {
    const userId = online.get(sid);
    if (userId === undefined || seen.has(userId)) continue;
    seen.add(userId);
    const u = getUserById.get(userId);
    if (u) members.push(publicUser(u));
  }
  return members;
}

// --- party-room helpers ------------------------------------------------------

function roomSummary(r: LiveRoom) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    topic: r.topic,
    category: r.category,
    locked: !!r.pin,
    creator: r.creator,
    members: roomMembers(r.id).length,
  };
}

function roomState(r: LiveRoom) {
  return {
    roomId: r.id,
    name: r.name,
    hostId: r.hostId,
    admins: [...r.admins],
    layout: r.layout,
    locked: !!r.pin,
    disabled: [...r.disabled],
    background: r.background,
    seats: r.seats.map((s) => {
      if (!s) return null;
      const u = getUserById.get(s.userId);
      return u ? { ...publicUser(u), muted: s.muted, blocked: s.blocked } : null;
    }),
    requests: [...r.requests.entries()]
      .map(([userId, seat]) => {
        const u = getUserById.get(userId);
        return u ? { user: publicUser(u), seat } : null;
      })
      .filter(Boolean),
  };
}

function broadcastRoom(r: LiveRoom) {
  io.to(`room:${r.id}`).emit("room:state", roomState(r));
}

// Re-push room state for every room the user occupies (e.g. after an avatar or
// name change) so seats/members reflect it live.
function rebroadcastUserRooms(userId: number) {
  for (const r of rooms.values()) {
    if (roomMembers(r.id).some((m: any) => m.id === userId)) broadcastRoom(r);
  }
}

function musicPayload(r: LiveRoom) {
  return { roomId: r.id, music: r.music, serverNow: Date.now() };
}
function broadcastMusic(r: LiveRoom) {
  io.to(`room:${r.id}`).emit("room:music", musicPayload(r));
}

/** Starts a track playing in a room; shared by play / next / prev. */
function beginTrack(r: LiveRoom, track: { id: number; name: string; src: string }, ownerId: number, ownerName: string) {
  r.music = {
    trackId: track.id,
    src: track.src,
    name: track.name,
    ownerId,
    ownerName,
    playing: true,
    startedAt: Date.now(),
    offset: 0,
  };
  broadcastMusic(r);
}

/** The current music owner's library in playlist order (position, then id). */
function musicQueue(r: LiveRoom) {
  return r.music ? (listMusic.all(r.music.ownerId) as { id: number; name: string; src: string }[]) : [];
}

// System notice in the room chat (moderation actions, etc.).
function systemMessage(r: LiveRoom, text: string) {
  const list = roomMessages.get(r.id);
  if (!list) return;
  const msg: RoomMsg = { id: roomMsgSeq++, userId: 0, author: "", avatar: "", frame: null, text, ts: Date.now(), system: true };
  list.push(msg);
  if (list.length > 200) list.shift();
  io.to(`room:${r.id}`).emit("room:message", { roomId: r.id, message: msg });
}

function isStaff(r: LiveRoom, userId: number) {
  return r.hostId === userId || r.admins.includes(userId);
}

/** Host can moderate everyone but themselves; admins only regular members. */
function canModerate(r: LiveRoom, actorId: number, targetId: number) {
  if (actorId === targetId) return false;
  if (r.hostId === actorId) return true;
  if (r.admins.includes(actorId)) return targetId !== r.hostId && !r.admins.includes(targetId);
  return false;
}

function seatUser(r: LiveRoom, userId: number, seat: number): boolean {
  if (seat < 0 || seat >= SEAT_COUNT || r.seats[seat]) return false;
  if (r.seats.some((s) => s?.userId === userId)) return false;
  r.seats[seat] = { userId, muted: false, blocked: false };
  r.requests.delete(userId);
  r.invites.delete(userId);
  return true;
}

/** Drop absent users from seats/roles, transfer host, close the room if empty. */
function reconcileRoom(roomId: string) {
  const r = rooms.get(roomId);
  if (!r) return;
  const members = roomMembers(roomId);
  if (!members.length) {
    rooms.delete(roomId);
    roomMessages.delete(roomId);
    return;
  }
  const present = new Set(members.map((m: any) => m.id));
  r.seats = r.seats.map((s) => (s && present.has(s.userId) ? s : null));
  r.admins = r.admins.filter((id) => present.has(id));
  for (const uid of [...r.requests.keys()]) if (!present.has(uid)) r.requests.delete(uid);
  for (const uid of [...r.invites.keys()]) if (!present.has(uid)) r.invites.delete(uid);
  if (!present.has(r.hostId)) {
    r.hostId = r.admins[0] ?? (members[0] as any).id;
    r.admins = r.admins.filter((id) => id !== r.hostId);
  }
  io.to(`room:${roomId}`).emit("room:members", { roomId, members });
  broadcastRoom(r);
}

function endSession(sessionId: string, exceptSocketId?: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  // Pending DM invite: tell the callee's phones to stop ringing.
  if (session.mode === "dm" && session.peers.length === 1 && session.calleeUserId !== undefined) {
    for (const sid of userSockets(session.calleeUserId)) io.to(sid).emit("dm:call:cancelled", { sessionId });
  }
  for (const sid of session.peers) {
    if (sid !== exceptSocketId) io.to(sid).emit("session:ended", { sessionId });
    io.sockets.sockets.get(sid)?.leave(sessionId);
  }
}

io.on("connection", (socket: Socket) => {
  let user: UserRow | null = null;

  const refresh = () => {
    if (user) user = getUserById.get(user.id) ?? null;
    return user;
  };

  function authOk(u: UserRow, ack: any) {
    user = u;
    online.set(socket.id, u.id);
    broadcastPresence();
    ack?.({
      user: publicUser(u),
      coins: u.coins,
      vip: !!u.vip,
      inventory: listInventory.all(u.id),
    });
  }

  // --- auth ----------------------------------------------------------------

  socket.on("auth:supabase", async ({ accessToken, nickname, avatar }, ack) => {
    const res = await verifySupabaseToken(String(accessToken ?? ""), {
      nickname: nickname ? String(nickname) : undefined,
      avatar: avatar ? String(avatar) : undefined,
    });
    if ("error" in res) return ack?.({ error: res.error });
    authOk(res.user, ack);
  });

  // --- matchmaking (random chat / random call) -------------------------------

  socket.on("queue:join", ({ mode }: { mode: Mode }) => {
    if (!user || (mode !== "chat" && mode !== "call")) return;
    const q = queues[mode];
    if (q.includes(socket.id)) return;
    // Never match a user with their own second tab.
    const otherId = q.find((sid) => online.has(sid) && online.get(sid) !== user!.id);
    if (!otherId) {
      q.push(socket.id);
      return;
    }
    q.splice(q.indexOf(otherId), 1);
    const sessionId = `s_${randomUUID().slice(0, 8)}`;
    sessions.set(sessionId, { mode, peers: [socket.id, otherId] });
    const other = io.sockets.sockets.get(otherId);
    socket.join(sessionId);
    other?.join(sessionId);
    const otherUser = getUserById.get(online.get(otherId)!)!;
    socket.emit("match:found", { sessionId, mode, role: "caller", peer: publicUser(otherUser) });
    io.to(otherId).emit("match:found", { sessionId, mode, role: "callee", peer: publicUser(refresh() ?? user) });
  });

  socket.on("queue:leave", () => {
    for (const q of Object.values(queues)) {
      const i = q.indexOf(socket.id);
      if (i >= 0) q.splice(i, 1);
    }
  });

  socket.on("session:message", ({ sessionId, text }) => {
    const session = sessions.get(sessionId);
    const t = String(text ?? "").slice(0, 500);
    if (!session || !session.peers.includes(socket.id) || !t) return;
    socket.to(sessionId).emit("session:message", { sessionId, text: t, ts: Date.now() });
  });

  socket.on("session:leave", ({ sessionId }) => endSession(sessionId, socket.id));

  socket.on("rtc:signal", ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.peers.includes(socket.id)) return;
    socket.to(sessionId).emit("rtc:signal", { sessionId, data });
  });

  // --- party rooms -------------------------------------------------------------

  socket.on("rooms:create", ({ category, name, topic, pin }, ack) => {
    if (!user) return;
    const n = String(name ?? "").trim().slice(0, 30);
    if (!ROOM_CATEGORIES.includes(category)) return ack?.({ error: "Pick a room category" });
    if (!n) return ack?.({ error: "Give your room a name" });
    let pinValue: string | null = null;
    if (pin !== undefined && pin !== null && pin !== "") {
      if (!/^\d{4}$/.test(String(pin))) return ack?.({ error: "PIN must be exactly 4 digits" });
      pinValue = String(pin);
    }
    const room: LiveRoom = {
      id: `r_${randomUUID().slice(0, 8)}`,
      name: n,
      icon: CATEGORY_ICONS[category as RoomCategory],
      topic: String(topic ?? "").trim().slice(0, 60),
      category,
      pin: pinValue,
      hostId: user.id,
      creator: publicUser(user),
      seats: Array(SEAT_COUNT).fill(null),
      admins: [],
      requests: new Map(),
      invites: new Map(),
      banned: new Set(),
      disabled: new Set(),
      layout: "grid",
      background: null,
      music: null,
    };
    rooms.set(room.id, room);
    roomMessages.set(room.id, []);
    ack?.({ room: roomSummary(room) });
  });

  socket.on("rooms:list", (ack) => {
    ack?.([...rooms.values()].map(roomSummary));
  });

  socket.on("room:join", ({ roomId, pin }, ack) => {
    const r = rooms.get(roomId);
    if (!user || !r) return ack?.(null);
    if (r.banned.has(user.id)) return ack?.({ error: "banned" });
    if (r.pin && user.id !== r.hostId) {
      if (pin === undefined || pin === null || pin === "") return ack?.({ error: "pin_required" });
      if (String(pin) !== r.pin) return ack?.({ error: "pin_wrong" });
    }
    socket.join(`room:${roomId}`);
    ack?.({
      room: roomSummary(r),
      messages: roomMessages.get(roomId),
      members: roomMembers(roomId),
      state: roomState(r),
      myInviteSeat: r.invites.get(user.id) ?? null,
      music: musicPayload(r),
    });
    io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
    broadcastRoom(r);
  });

  socket.on("room:leave", ({ roomId }) => {
    socket.leave(`room:${roomId}`);
    reconcileRoom(roomId);
  });

  socket.on("room:message", ({ roomId, text }) => {
    // refresh() so messages carry the *current* avatar/frame, not the ones
    // from when this socket connected.
    const u = refresh();
    const t = String(text ?? "").slice(0, 500);
    if (!u || !t || !roomMessages.has(roomId)) return;
    if (rooms.get(roomId)?.disabled.has(u.id)) return; // moderator blocked typing
    const msg: RoomMsg = {
      id: roomMsgSeq++,
      userId: u.id,
      author: u.nickname,
      avatar: u.avatar,
      frame: u.frame ?? null,
      text: t,
      ts: Date.now(),
    };
    const list = roomMessages.get(roomId)!;
    list.push(msg);
    if (list.length > 200) list.shift();
    io.to(`room:${roomId}`).emit("room:message", { roomId, message: msg });
  });

  // Seat lifecycle: listeners request → host/admin grants; or staff invites → user accepts.

  socket.on("seat:request", ({ roomId, seat }) => {
    const r = rooms.get(roomId);
    const s = Number(seat);
    if (!user || !r || s < 0 || s >= SEAT_COUNT || r.seats[s]) return;
    if (r.seats.some((x) => x?.userId === user!.id)) return;
    // Host/admins skip the queue and sit directly.
    if (isStaff(r, user.id)) {
      if (seatUser(r, user.id, s)) broadcastRoom(r);
      return;
    }
    r.requests.set(user.id, s);
    broadcastRoom(r);
  });

  socket.on("seat:cancel", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!user || !r) return;
    r.requests.delete(user.id);
    broadcastRoom(r);
  });

  socket.on("seat:grant", ({ roomId, userId }) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    if (!user || !r || !isStaff(r, user.id)) return;
    const wanted = r.requests.get(target);
    if (wanted === undefined) return;
    if (!seatUser(r, target, wanted)) r.requests.delete(target); // seat got taken meanwhile
    broadcastRoom(r);
  });

  socket.on("seat:deny", ({ roomId, userId }) => {
    const r = rooms.get(roomId);
    if (!user || !r || !isStaff(r, user.id)) return;
    r.requests.delete(Number(userId));
    broadcastRoom(r);
  });

  socket.on("seat:invite", ({ roomId, userId, seat }) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    const s = Number(seat);
    if (!user || !r || !isStaff(r, user.id)) return;
    if (s < 0 || s >= SEAT_COUNT || r.seats[s]) return;
    if (!roomMembers(roomId).some((m: any) => m.id === target)) return;
    if (r.seats.some((x) => x?.userId === target)) return;
    r.invites.set(target, s);
    for (const sid of userSockets(target)) io.to(sid).emit("room:seatInvite", { roomId, seat: s });
  });

  socket.on("seat:accept", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!user || !r) return;
    const s = r.invites.get(user.id);
    if (s === undefined) return;
    r.invites.delete(user.id);
    if (seatUser(r, user.id, s)) broadcastRoom(r);
  });

  socket.on("seat:decline", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!user || !r) return;
    r.invites.delete(user.id);
  });

  socket.on("seat:leave", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!user || !r) return;
    const i = r.seats.findIndex((x) => x?.userId === user!.id);
    if (i < 0) return;
    r.seats[i] = null;
    broadcastRoom(r);
  });

  socket.on("seat:mute", ({ roomId, muted }) => {
    const r = rooms.get(roomId);
    if (!user || !r) return;
    const seat = r.seats.find((x) => x?.userId === user!.id);
    if (!seat) return;
    seat.muted = !!muted;
    broadcastRoom(r);
  });

  // LiveKit access for room audio: any member may subscribe/publish; the
  // client only actually publishes while seated & unmuted. Env-gated —
  // without LIVEKIT_* vars the room UI shows "audio not configured".
  socket.on("livekit:token", async ({ roomId }, ack) => {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return ack?.({ error: "not_configured" });
    const r = rooms.get(roomId);
    if (!user || !r) return ack?.({ error: "no_room" });
    if (!roomMembers(roomId).some((m: any) => m.id === user!.id)) return ack?.({ error: "not_member" });
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(user.id),
      name: user.nickname,
      ttl: "6h",
    });
    at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
    ack?.({ url: LIVEKIT_URL, token: await at.toJwt() });
  });

  // --- room moderation (host/admin) ---------------------------------------

  socket.on("seat:forceMute", ({ roomId, userId, blocked }) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    if (!user || !r || !canModerate(r, user.id, target)) return;
    const seat = r.seats.find((s) => s?.userId === target);
    if (!seat) return;
    seat.blocked = !!blocked;
    if (blocked) systemMessage(r, `${user.nickname} muted ${getUserById.get(target)?.nickname ?? "a user"}`);
    broadcastRoom(r);
  });

  // Disable = mute mic (if seated) + block typing, for any member.
  socket.on("seat:disable", ({ roomId, userId, disabled }) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    if (!user || !r || !canModerate(r, user.id, target)) return;
    const seat = r.seats.find((s) => s?.userId === target);
    if (disabled) {
      r.disabled.add(target);
      if (seat) seat.blocked = true;
      systemMessage(r, `${user.nickname} disabled ${getUserById.get(target)?.nickname ?? "a user"}`);
    } else {
      r.disabled.delete(target);
      if (seat) seat.blocked = false;
    }
    broadcastRoom(r);
  });

  socket.on("seat:remove", ({ roomId, userId }) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    if (!user || !r || !canModerate(r, user.id, target)) return;
    const i = r.seats.findIndex((s) => s?.userId === target);
    if (i < 0) return;
    r.seats[i] = null;
    broadcastRoom(r);
  });

  socket.on("room:kick", ({ roomId, userId }) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    if (!user || !r || !canModerate(r, user.id, target)) return;
    r.banned.add(target);
    systemMessage(r, `${user.nickname} removed ${getUserById.get(target)?.nickname ?? "a user"} from the room`);
    for (const sid of userSockets(target)) {
      const s = io.sockets.sockets.get(sid);
      if (s?.rooms.has(`room:${roomId}`)) {
        s.leave(`room:${roomId}`);
        io.to(sid).emit("room:kicked", { roomId, roomName: r.name });
      }
    }
    reconcileRoom(roomId);
  });

  socket.on("room:rename", ({ roomId, name }, ack) => {
    const r = rooms.get(roomId);
    if (!user || !r || r.hostId !== user.id) return ack?.({ error: "Only the host can rename the room" });
    const n = String(name ?? "").trim().slice(0, 30);
    if (!n) return ack?.({ error: "Give the room a name" });
    r.name = n;
    broadcastRoom(r);
    ack?.({ name: n });
  });

  socket.on("room:setPin", ({ roomId, pin }, ack) => {
    const r = rooms.get(roomId);
    if (!user || !r || r.hostId !== user.id) return ack?.({ error: "Only the host can lock the room" });
    if (pin === null || pin === undefined || pin === "") {
      r.pin = null;
    } else {
      if (!/^\d{4}$/.test(String(pin))) return ack?.({ error: "PIN must be exactly 4 digits" });
      r.pin = String(pin);
    }
    broadcastRoom(r);
    ack?.({ locked: !!r.pin });
  });

  socket.on("room:layout", ({ roomId, layout }) => {
    const r = rooms.get(roomId);
    if (!user || !r || r.hostId !== user.id) return;
    if (layout !== "grid" && layout !== "couple") return;
    r.layout = layout;
    broadcastRoom(r);
  });

  // Purchased backgrounds are used here — the host picks from ones they own.
  socket.on("room:backgrounds", (ack) => {
    if (!user) return ack?.([]);
    ack?.((ownedCosmetics.all(user.id, "background") as any[]).map((r) => ({ src: r.src })));
  });

  socket.on("room:setBackground", ({ roomId, src }) => {
    const r = rooms.get(roomId);
    if (!user || !r || r.hostId !== user.id) return;
    if (src === null || src === "") r.background = null;
    else if ((ownedCosmetics.all(user.id, "background") as any[]).some((x) => x.src === src)) r.background = String(src);
    else return;
    broadcastRoom(r);
  });

  socket.on("admin:set", ({ roomId, userId, admin }, ack) => {
    const r = rooms.get(roomId);
    const target = Number(userId);
    if (!user || !r || r.hostId !== user.id || target === r.hostId) {
      return ack?.({ error: "Only the host can manage admins" });
    }
    if (admin) {
      if (r.admins.includes(target)) return;
      if (r.admins.length >= 2) return ack?.({ error: "A room can have at most 2 admins" });
      if (!roomMembers(roomId).some((m: any) => m.id === target)) return;
      r.admins.push(target);
    } else {
      r.admins = r.admins.filter((id) => id !== target);
    }
    broadcastRoom(r);
    ack?.({ ok: true });
  });

  // --- room music (player lives on page 2 of the room) -----------------------

  socket.on("music:list", (ack) => {
    if (!user) return ack?.([]);
    ack?.(listMusic.all(user.id));
  });

  socket.on("music:delete", ({ id }, ack) => {
    if (!user) return;
    const track = getMusic.get(Number(id));
    if (!track || track.user_id !== user.id) return ack?.({ error: "Not your track" });
    db.prepare("DELETE FROM music WHERE id = ?").run(track.id);
    // If it was playing anywhere, don't leave the room pointing at a dead file.
    for (const r of rooms.values()) {
      if (r.music?.trackId === track.id) {
        r.music = null;
        broadcastMusic(r);
      }
    }
    ack?.(listMusic.all(user.id));
  });

  socket.on("music:reorder", ({ ids }, ack) => {
    if (!user) return ack?.({ error: "Not signed in" });
    const idList = Array.isArray(ids) ? ids.map(Number) : [];
    const owned = listMusic.all(user.id) as { id: number }[];
    const ownedIds = new Set(owned.map((t) => t.id));
    if (idList.length !== ownedIds.size || !idList.every((id) => ownedIds.has(id))) {
      return ack?.({ error: "Track list doesn't match your library" });
    }
    db.transaction(() => idList.forEach((id, i) => setMusicPosition.run(i, id, user!.id)))();
    ack?.(listMusic.all(user.id));
  });

  // Anyone in the room can play their OWN uploaded track; the person who
  // started it and host/admins can pause/resume/stop/skip.
  const canControlMusic = (r: LiveRoom) => !!user && !!r.music && (r.music.ownerId === user.id || isStaff(r, user.id));

  socket.on("room:musicPlay", ({ roomId, id }, ack) => {
    const r = rooms.get(roomId);
    const track = getMusic.get(Number(id));
    if (!user || !r || !track) return ack?.({ error: "Track not found" });
    if (track.user_id !== user.id) return ack?.({ error: "You can only play your own uploads" });
    if (!roomMembers(roomId).some((m: any) => m.id === user!.id)) return ack?.({ error: "Join the room first" });
    if (r.music && !canControlMusic(r)) return ack?.({ error: "Someone else's track is playing" });
    beginTrack(r, track, user.id, user.nickname);
    systemMessage(r, `${user.nickname} started playing ♪ ${track.name}`);
    ack?.({ ok: true });
  });

  socket.on("room:musicPause", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!r?.music?.playing || !canControlMusic(r)) return;
    r.music.offset += (Date.now() - r.music.startedAt) / 1000;
    r.music.playing = false;
    broadcastMusic(r);
  });

  socket.on("room:musicResume", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!r?.music || r.music.playing || !canControlMusic(r)) return;
    r.music.startedAt = Date.now();
    r.music.playing = true;
    broadcastMusic(r);
  });

  socket.on("room:musicStop", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!r?.music || !canControlMusic(r)) return;
    r.music = null;
    broadcastMusic(r);
  });

  // Seeking: drag the progress bar to a position (seconds). Keeps play state.
  socket.on("room:musicSeek", ({ roomId, time }) => {
    const r = rooms.get(roomId);
    if (!r?.music || !canControlMusic(r)) return;
    r.music.offset = Math.max(0, Number(time) || 0);
    r.music.startedAt = Date.now();
    broadcastMusic(r);
  });

  // Next/prev walk the current owner's library in playlist order, looping by
  // default. `trackId` is the client's idea of what's currently playing —
  // used as an idempotency guard so an auto-advance race (e.g. two devices
  // both detecting "ended") only advances once.
  socket.on("room:musicNext", ({ roomId, trackId }, ack) => {
    const r = rooms.get(roomId);
    if (!r?.music || !canControlMusic(r)) return ack?.({ error: "No permission" });
    if (trackId !== undefined && Number(trackId) !== r.music.trackId) return ack?.({ ok: true }); // stale, already advanced
    const queue = musicQueue(r);
    if (!queue.length) {
      r.music = null;
      broadcastMusic(r);
      return ack?.({ ok: true });
    }
    const idx = queue.findIndex((t) => t.id === r.music!.trackId);
    const next = queue[(idx + 1 + queue.length) % queue.length];
    beginTrack(r, next, r.music.ownerId, r.music.ownerName);
    ack?.({ ok: true });
  });

  socket.on("room:musicPrev", ({ roomId, trackId }, ack) => {
    const r = rooms.get(roomId);
    if (!r?.music || !canControlMusic(r)) return ack?.({ error: "No permission" });
    if (trackId !== undefined && Number(trackId) !== r.music.trackId) return ack?.({ ok: true });
    const queue = musicQueue(r);
    if (!queue.length) {
      r.music = null;
      broadcastMusic(r);
      return ack?.({ ok: true });
    }
    const idx = queue.findIndex((t) => t.id === r.music!.trackId);
    const prev = queue[(idx - 1 + queue.length) % queue.length];
    beginTrack(r, prev, r.music.ownerId, r.music.ownerName);
    ack?.({ ok: true });
  });

  // --- direct messages -------------------------------------------------------

  socket.on("dm:conversations", (ack) => {
    if (!user) return ack?.([]);
    const mine = user.id;
    const rowsDb = dmRecent.all(mine, mine) as any[];
    const byPartner = new Map<number, { last: any; unread: number }>();
    for (const m of rowsDb) {
      const partner = m.sender === mine ? m.recipient : m.sender;
      let entry = byPartner.get(partner);
      if (!entry) {
        entry = { last: m, unread: 0 };
        byPartner.set(partner, entry);
      }
      if (m.recipient === mine && !m.read) entry.unread++;
    }
    const list = [...byPartner.entries()]
      .map(([partnerId, { last, unread }]) => {
        const partner = getUserById.get(partnerId);
        return partner
          ? { user: publicUser(partner), last: { text: last.text, ts: last.ts, mine: last.sender === mine }, unread }
          : null;
      })
      .filter(Boolean);
    ack?.(list);
  });

  socket.on("dm:history", ({ userId }, ack) => {
    const partner = getUserById.get(Number(userId));
    if (!user || !partner) return ack?.(null);
    dmMarkRead.run(partner.id, user.id);
    const messages = (dmHistory.all({ a: user.id, b: partner.id }) as any[])
      .reverse()
      .map((m) => ({ id: m.id, text: m.text, ts: m.ts, mine: m.sender === user!.id }));
    ack?.({ peer: publicUser(partner), messages });
  });

  socket.on("dm:send", ({ userId, text }, ack) => {
    const u = refresh();
    const partner = getUserById.get(Number(userId));
    const t = String(text ?? "").trim().slice(0, 500);
    if (!u || !partner || !t || partner.id === u.id) return ack?.(null);
    const ts = Date.now();
    const info = insertDm.run(u.id, partner.id, t, ts);
    const message = { id: Number(info.lastInsertRowid), text: t, ts };
    for (const sid of userSockets(partner.id)) {
      io.to(sid).emit("dm:new", { from: publicUser(u), message });
    }
    ack?.({ ...message, mine: true });
  });

  socket.on("dm:read", ({ userId }) => {
    if (user) dmMarkRead.run(Number(userId), user.id);
  });

  // --- DM calls ---------------------------------------------------------------

  socket.on("dm:call:invite", ({ userId }, ack) => {
    const callee = getUserById.get(Number(userId));
    if (!user || !callee || callee.id === user.id) return ack?.({ error: "Can't call that user" });
    const calleeSockets = userSockets(callee.id);
    if (!calleeSockets.length) return ack?.({ error: `${callee.nickname} is offline` });
    const sessionId = `s_${randomUUID().slice(0, 8)}`;
    sessions.set(sessionId, { mode: "dm", peers: [socket.id], inviterUserId: user.id, calleeUserId: callee.id });
    socket.join(sessionId);
    for (const sid of calleeSockets) io.to(sid).emit("dm:call:incoming", { sessionId, from: publicUser(user) });
    ack?.({ sessionId, peer: publicUser(callee) });
  });

  socket.on("dm:call:accept", ({ sessionId }, ack) => {
    const session = sessions.get(sessionId);
    if (!user || !session || session.mode !== "dm" || session.calleeUserId !== user.id || session.peers.length !== 1) {
      return ack?.({ error: "That call is no longer available" });
    }
    const inviterSocket = session.peers[0];
    const inviter = getUserById.get(session.inviterUserId!);
    if (!online.has(inviterSocket) || !inviter) {
      sessions.delete(sessionId);
      return ack?.({ error: "The caller hung up" });
    }
    session.peers.push(socket.id);
    socket.join(sessionId);
    // Stop ringing on the callee's other tabs/devices.
    for (const sid of userSockets(user.id)) {
      if (sid !== socket.id) io.to(sid).emit("dm:call:cancelled", { sessionId });
    }
    io.to(inviterSocket).emit("dm:call:start", { sessionId, role: "caller", peer: publicUser(refresh() ?? user) });
    ack?.({ sessionId, role: "callee", peer: publicUser(inviter) });
  });

  socket.on("dm:call:decline", ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!user || !session || session.mode !== "dm" || session.calleeUserId !== user.id) return;
    sessions.delete(sessionId);
    for (const sid of userSockets(user.id)) io.to(sid).emit("dm:call:cancelled", { sessionId });
    io.to(session.peers[0]).emit("dm:call:declined", { sessionId });
  });

  // --- feed --------------------------------------------------------------------

  socket.on("feed:list", ({ tab }, ack) => {
    if (!user) return ack?.([]);
    const stmt = tab === "following" ? feedFollowing : feedPublic;
    ack?.(stmt.all({ viewer: user.id }).map((r) => serializeFeedRow(r, user!.id)));
  });

  socket.on("feed:user", ({ userId }, ack) => {
    if (!user) return ack?.([]);
    const target = Number(userId) || user.id;
    ack?.(feedByUser.all({ viewer: user.id, target }).map((r) => serializeFeedRow(r, user!.id)));
  });

  socket.on("feed:post", async ({ text, image }, ack) => {
    const t = String(text ?? "").trim().slice(0, 500);
    let imagePath: string | null = null;
    if (typeof image === "string" && image) {
      imagePath = await saveDataUrlImage(image);
      if (!imagePath) return ack?.({ error: "Image must be PNG/JPEG/WebP under 2 MB" });
    }
    if (!user || (!t && !imagePath)) return ack?.(null);
    const info = insertPost.run(user.id, t, imagePath, Date.now());
    const row = getPostRow.get({ viewer: user.id, id: Number(info.lastInsertRowid) });
    io.emit("feed:new", { post: serializeFeedRow(row, -1) });
    ack?.(serializeFeedRow(row, user.id));
  });

  socket.on("feed:like", ({ id }, ack) => {
    if (!user) return;
    const postId = Number(id);
    if (hasLike.get(postId, user.id)) unlikeStmt.run(postId, user.id);
    else likeStmt.run(postId, user.id);
    const row: any = getPostRow.get({ viewer: user.id, id: postId });
    if (row) ack?.({ id: postId, likes: row.likes, liked: !!row.liked });
  });

  socket.on("feed:one", ({ id }, ack) => {
    if (!user) return ack?.(null);
    const row = getPostRow.get({ viewer: user.id, id: Number(id) });
    ack?.(row ? serializeFeedRow(row, user.id) : null);
  });

  socket.on("feed:delete", ({ id }, ack) => {
    if (!user) return ack?.({ error: "Not signed in" });
    const pid = Number(id);
    const row = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(pid) as { user_id: number } | undefined;
    if (!row || row.user_id !== user.id) return ack?.({ error: "You can only delete your own posts" });
    db.transaction(() => {
      db.prepare("DELETE FROM comments WHERE post_id = ?").run(pid);
      db.prepare("DELETE FROM likes WHERE post_id = ?").run(pid);
      db.prepare("DELETE FROM posts WHERE id = ?").run(pid);
    })();
    io.emit("feed:removed", { postId: pid });
    ack?.({ ok: true });
  });

  socket.on("feed:comments", ({ postId }, ack) => {
    if (!user) return ack?.([]);
    ack?.(listComments.all(Number(postId)));
  });

  socket.on("feed:comment", ({ postId, text }, ack) => {
    const u = refresh();
    const t = String(text ?? "").trim().slice(0, 300);
    const pid = Number(postId);
    if (!u || !t || !getPostRow.get({ viewer: u.id, id: pid })) return ack?.(null);
    const ts = Date.now();
    const info = insertComment.run(pid, u.id, t, ts);
    const comment = {
      id: Number(info.lastInsertRowid),
      text: t,
      ts,
      userId: u.id,
      author: u.nickname,
      avatar: u.avatar,
      frame: u.frame ?? null,
    };
    io.emit("feed:commented", { postId: pid, comments: countComments.get(pid)!.c });
    ack?.(comment);
  });

  // --- user profiles ---------------------------------------------------------

  socket.on("user:profile", ({ userId }, ack) => {
    const target = getUserById.get(Number(userId));
    if (!user || !target) return ack?.(null);
    if (target.id !== user.id) recordVisit.run(user.id, target.id, Date.now());
    ack?.({
      user: publicUser(target),
      background: target.profile_bg ?? null,
      banner: target.banner ?? null,
      followers: followerCount.get(target.id)!.c,
      following: followingCount.get(target.id)!.c,
      posts: postCount.get(target.id)!.c,
      isFollowing: !!hasFollow.get(user.id, target.id),
      followsYou: !!hasFollow.get(target.id, user.id),
    });
  });

  socket.on("user:follows", ({ userId }, ack) => {
    const target = getUserById.get(Number(userId));
    if (!user || !target) return ack?.(null);
    const hydrate = (rows: any[]) =>
      rows.map((r) => getUserById.get(r.uid)).filter(Boolean).map((u) => publicUser(u!));
    ack?.({
      followers: hydrate(listFollowers.all(target.id) as any[]),
      following: hydrate(listFollowing.all(target.id) as any[]),
    });
  });

  // Custom banner photo (uploaded, unlike preset cosmetics).
  socket.on("user:setBanner", async ({ image }, ack) => {
    const u = refresh();
    if (!u) return ack?.({ error: "Not signed in" });
    if (image === null || image === "") {
      db.prepare("UPDATE users SET banner = NULL WHERE id = ?").run(u.id);
      return ack?.({ banner: null });
    }
    const path = await saveDataUrlImage(String(image));
    if (!path) return ack?.({ error: "Image must be PNG/JPEG/WebP under 2 MB" });
    db.prepare("UPDATE users SET banner = ? WHERE id = ?").run(path, u.id);
    ack?.({ banner: path });
  });

  socket.on("user:rename", ({ name }, ack) => {
    const u = refresh();
    if (!u) return ack?.({ error: "Not signed in" });
    const n = String(name ?? "").trim().slice(0, 20);
    if (!n) return ack?.({ error: "Name can't be empty" });
    db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(n, u.id);
    broadcastPresence();
    rebroadcastUserRooms(u.id);
    ack?.({ nickname: n });
  });

  socket.on("user:visits", (ack) => {
    if (!user) return ack?.(null);
    const hydrate = (rows: any[]) =>
      rows
        .map((r) => {
          const u = getUserById.get(r.uid);
          return u ? { user: publicUser(u), ts: r.ts } : null;
        })
        .filter(Boolean);
    ack?.({
      visitors: hydrate(listVisitors.all(user.id) as any[]),
      visited: hydrate(listVisited.all(user.id) as any[]),
    });
  });

  // --- cosmetics shop (avatar / frame / background / bubble / pet) ------------

  socket.on("shop:catalog", (ack) => {
    const u = refresh();
    if (!u) return ack?.(null);
    ack?.({
      coins: u.coins,
      categories: SHOP_TYPES.map((type) => ({
        type,
        items: catalogFor(type),
        owned: (ownedCosmetics.all(u.id, type) as any[]).map((r) => r.src),
        equipped: equippedOf(u, type),
      })),
    });
  });

  socket.on("shop:buy", ({ type, src }, ack) => {
    const u = refresh();
    if (!u || !isShopType(type)) return ack?.({ error: "Unknown item" });
    const item = catalogFor(type).find((i) => i.src === src);
    if (!item) return ack?.({ error: "Unknown item" });
    const owned = (ownedCosmetics.all(u.id, type) as any[]).map((r) => r.src);
    if (owned.includes(src)) return ack?.({ error: "Already owned" });
    if (u.coins < item.price) return ack?.({ error: "Not enough coins" });
    db.transaction(() => {
      setCoins.run(u.coins - item.price, u.id);
      addCosmetic.run(u.id, type, src);
      EQUIP_STMT[type].run(src, u.id);
    })();
    afterEquip(u.id);
    ack?.({ coins: u.coins - item.price, owned: [...owned, src], equipped: src });
  });

  socket.on("shop:equip", ({ type, src }, ack) => {
    const u = refresh();
    if (!u || !isShopType(type)) return ack?.({ error: "Unknown item" });
    const owned = (ownedCosmetics.all(u.id, type) as any[]).map((r) => r.src);
    if (!owned.includes(src)) return ack?.({ error: "You don't own that yet" });
    EQUIP_STMT[type].run(src, u.id);
    afterEquip(u.id);
    ack?.({ equipped: src });
  });

  socket.on("shop:unequip", ({ type }, ack) => {
    const u = refresh();
    if (!u || !isShopType(type) || type === "avatar") return ack?.({ error: "Can't remove that" });
    EQUIP_STMT[type].run(null, u.id);
    afterEquip(u.id);
    ack?.({ equipped: null });
  });

  // --- admin panel (manage shop items) — TEMPORARY hardcoded creds ------------

  socket.on("admin:login", ({ id, password }, ack) => {
    if (String(id ?? "") !== ADMIN_ID || String(password ?? "") !== ADMIN_PASSWORD) {
      return ack?.({ error: "Wrong admin ID or password" });
    }
    const token = randomUUID();
    adminTokens.add(token);
    ack?.({ token, types: SHOP_TYPES });
  });

  socket.on("admin:items", ({ token }, ack) => {
    if (!isAdmin(token)) return ack?.({ error: "Not authorized" });
    ack?.({ items: allShopItems.all() });
  });

  socket.on("admin:itemSave", async ({ token, item }, ack) => {
    if (!isAdmin(token)) return ack?.({ error: "Not authorized" });
    const type = item?.type;
    const name = String(item?.name ?? "").trim().slice(0, 40);
    const price = Math.floor(Number(item?.price));
    if (!isShopType(type)) return ack?.({ error: "Pick a category" });
    if (!name) return ack?.({ error: "Name is required" });
    if (!Number.isFinite(price) || price < 0) return ack?.({ error: "Enter a valid price" });
    let src: string | null = item?.src ?? null;
    if (item?.image) {
      const path = await saveDataUrlImage(String(item.image));
      if (!path) return ack?.({ error: "Image must be PNG/JPEG/WebP under 2 MB" });
      src = path;
    }
    if (item?.id) {
      if (src) db.prepare("UPDATE shop_items SET type=?, name=?, price=?, src=? WHERE id=?").run(type, name, price, src, Number(item.id));
      else db.prepare("UPDATE shop_items SET type=?, name=?, price=? WHERE id=?").run(type, name, price, Number(item.id));
    } else {
      if (!src) return ack?.({ error: "An image is required" });
      insertShopItem.run(type, name, price, src, Date.now());
    }
    ack?.({ items: allShopItems.all() });
  });

  socket.on("admin:itemDelete", ({ token, id }, ack) => {
    if (!isAdmin(token)) return ack?.({ error: "Not authorized" });
    db.prepare("DELETE FROM shop_items WHERE id = ?").run(Number(id));
    ack?.({ items: allShopItems.all() });
  });

  socket.on("user:follow", ({ userId }, ack) => {
    const target = getUserById.get(Number(userId));
    if (!user || !target || target.id === user.id) return;
    if (hasFollow.get(user.id, target.id)) unfollowStmt.run(user.id, target.id);
    else followStmt.run(user.id, target.id);
    ack?.({ userId: target.id, following: !!hasFollow.get(user.id, target.id) });
  });

  // --- gacha / economy -----------------------------------------------------------

  socket.on("gacha:banners", (ack) => {
    ack?.(
      BANNERS.map((b) => ({
        id: b.id,
        name: b.name,
        icon: b.icon,
        tagline: b.tagline,
        theme: b.theme,
        mythic: b.pool.mythic[0],
        pool: Object.fromEntries(
          GACHA_RATES.map(([rarity, rate]) => [rarity, { rate, items: b.pool[rarity] }])
        ),
      }))
    );
  });

  socket.on("gacha:pull", ({ bannerId, count }, ack) => {
    const u = refresh();
    if (!u) return;
    const banner = BANNERS.find((b) => b.id === bannerId) ?? BANNERS[0];
    const n = count === 10 ? 10 : 1;
    const cost = n === 10 ? 900 : 100;
    if (u.coins < cost) return ack?.({ error: "Not enough coins" });
    const results = Array.from({ length: n }, () => rollOnce(banner.pool));
    // 10-pull pity: guarantee at least one rare or better.
    if (n === 10 && results.every((r) => r.rarity === "common")) results[n - 1] = rollOnce(banner.pool, "rare");
    const applyPull = db.transaction(() => {
      setCoins.run(u.coins - cost, u.id);
      for (const r of results) addInventory.run(u.id, r.name, r.icon, r.rarity);
    });
    applyPull();
    ack?.({ results, coins: u.coins - cost, inventory: listInventory.all(u.id) });
  });

  socket.on("daily:claim", (ack) => {
    const u = refresh();
    if (!u) return;
    const DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - u.last_daily < DAY) return ack?.({ error: "Already claimed today", coins: u.coins });
    const coins = u.coins + (u.vip ? 600 : 300);
    setDaily.run(Date.now(), coins, u.id);
    ack?.({ coins });
  });

  socket.on("vip:activate", (ack) => {
    const u = refresh();
    if (!u) return;
    if (u.vip) return ack?.({ vip: true, coins: u.coins });
    if (u.coins < 800) return ack?.({ error: "Not enough coins (VIP costs 800)" });
    setCoins.run(u.coins - 800, u.id);
    setVip.run(u.id);
    broadcastPresence();
    ack?.({ vip: true, coins: u.coins - 800 });
  });

  // --- disconnect ------------------------------------------------------------------

  socket.on("disconnecting", () => {
    for (const q of Object.values(queues)) {
      const i = q.indexOf(socket.id);
      if (i >= 0) q.splice(i, 1);
    }
    for (const [sessionId, session] of sessions) {
      if (session.peers.includes(socket.id)) endSession(sessionId, socket.id);
    }
    const joinedRooms = [...socket.rooms].filter((r) => r.startsWith("room:")).map((r) => r.slice(5));
    online.delete(socket.id);
    // Membership updates fire after the socket actually leaves.
    setImmediate(() => {
      for (const roomId of joinedRooms) reconcileRoom(roomId);
      broadcastPresence();
    });
  });
});

startSnapshotLoop(db);

httpServer.listen(PORT, () => {
  console.log(`[sora] server listening on http://localhost:${PORT}`);
});
