import "./env";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { basename, extname, join } from "node:path";
import { Server, type Socket } from "socket.io";
import { db, getUserById, publicUser, type UserRow } from "./db";
import { verifySupabaseToken } from "./auth";

const PORT = Number(process.env.PORT) || 3001;
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Live (non-persisted) state: presence, party rooms, matchmaking, calls.
// ---------------------------------------------------------------------------

const online = new Map<string, number>(); // socketId -> userId

const ROOM_CATEGORIES = ["music", "private", "chat"] as const;
type RoomCategory = (typeof ROOM_CATEGORIES)[number];

const SEAT_COUNT = 10; // rendered as 2 rows × 5 columns

interface SeatState {
  userId: number;
  muted: boolean;
}

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
}

interface RoomMsg {
  id: number;
  userId: number;
  author: string;
  avatar: string;
  text: string;
  ts: number;
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
  SELECT p.id, p.text, p.image, p.ts, p.user_id AS userId, u.nickname AS author, u.avatar,
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
  `SELECT c.id, c.text, c.ts, c.user_id AS userId, u.nickname AS author, u.avatar
   FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.ts LIMIT 200`
);
const countComments = db.prepare<[number], { c: number }>("SELECT COUNT(*) c FROM comments WHERE post_id = ?");

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
const MAX_IMAGE_BYTES = 2_000_000;

function saveDataUrlImage(dataUrl: string): string | null {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  const file = `${randomUUID()}.${m[1] === "jpg" ? "jpeg" : m[1]}`;
  writeFileSync(join(UPLOAD_DIR, file), buf);
  return `/uploads/${file}`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, online: online.size }));
    return;
  }
  if (req.url?.startsWith("/uploads/")) {
    const file = basename(req.url); // strips any path tricks
    const type = IMAGE_TYPES[extname(file).slice(1)];
    const path = join(UPLOAD_DIR, file);
    if (!type || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
    createReadStream(path).pipe(res);
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
    hostId: r.hostId,
    admins: [...r.admins],
    seats: r.seats.map((s) => {
      if (!s) return null;
      const u = getUserById.get(s.userId);
      return u ? { ...publicUser(u), muted: s.muted } : null;
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

function isStaff(r: LiveRoom, userId: number) {
  return r.hostId === userId || r.admins.includes(userId);
}

function seatUser(r: LiveRoom, userId: number, seat: number): boolean {
  if (seat < 0 || seat >= SEAT_COUNT || r.seats[seat]) return false;
  if (r.seats.some((s) => s?.userId === userId)) return false;
  r.seats[seat] = { userId, muted: false };
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
    io.to(otherId).emit("match:found", { sessionId, mode, role: "callee", peer: publicUser(user) });
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

  socket.on("rooms:create", ({ category, name, icon, topic, pin }, ack) => {
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
      icon: String(icon ?? "🎪").slice(0, 4),
      topic: String(topic ?? "").trim().slice(0, 60),
      category,
      pin: pinValue,
      hostId: user.id,
      creator: publicUser(user),
      seats: Array(SEAT_COUNT).fill(null),
      admins: [],
      requests: new Map(),
      invites: new Map(),
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
    });
    io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
    broadcastRoom(r);
  });

  socket.on("room:leave", ({ roomId }) => {
    socket.leave(`room:${roomId}`);
    reconcileRoom(roomId);
  });

  socket.on("room:message", ({ roomId, text }) => {
    const t = String(text ?? "").slice(0, 500);
    if (!user || !t || !roomMessages.has(roomId)) return;
    const msg: RoomMsg = {
      id: roomMsgSeq++,
      userId: user.id,
      author: user.nickname,
      avatar: user.avatar,
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
    const partner = getUserById.get(Number(userId));
    const t = String(text ?? "").trim().slice(0, 500);
    if (!user || !partner || !t || partner.id === user.id) return ack?.(null);
    const ts = Date.now();
    const info = insertDm.run(user.id, partner.id, t, ts);
    const message = { id: Number(info.lastInsertRowid), text: t, ts };
    for (const sid of userSockets(partner.id)) {
      io.to(sid).emit("dm:new", { from: publicUser(user), message });
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
    io.to(inviterSocket).emit("dm:call:start", { sessionId, role: "caller", peer: publicUser(user) });
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

  socket.on("feed:post", ({ text, image }, ack) => {
    const t = String(text ?? "").trim().slice(0, 500);
    let imagePath: string | null = null;
    if (typeof image === "string" && image) {
      imagePath = saveDataUrlImage(image);
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

  socket.on("feed:comments", ({ postId }, ack) => {
    if (!user) return ack?.([]);
    ack?.(listComments.all(Number(postId)));
  });

  socket.on("feed:comment", ({ postId, text }, ack) => {
    const t = String(text ?? "").trim().slice(0, 300);
    const pid = Number(postId);
    if (!user || !t || !getPostRow.get({ viewer: user.id, id: pid })) return ack?.(null);
    const ts = Date.now();
    const info = insertComment.run(pid, user.id, t, ts);
    const comment = { id: Number(info.lastInsertRowid), text: t, ts, userId: user.id, author: user.nickname, avatar: user.avatar };
    io.emit("feed:commented", { postId: pid, comments: countComments.get(pid)!.c });
    ack?.(comment);
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

httpServer.listen(PORT, () => {
  console.log(`[sora] server listening on http://localhost:${PORT}`);
});
