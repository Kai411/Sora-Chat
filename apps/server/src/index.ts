import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";

const PORT = Number(process.env.PORT) || 3001;

// ---------------------------------------------------------------------------
// In-memory state. Prototype only — swap for Postgres/Redis in phase 1.
// ---------------------------------------------------------------------------

type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

interface GachaItem {
  name: string;
  icon: string;
  rarity: Rarity;
}

interface Profile {
  nickname: string;
  avatar: string;
  coins: number;
  vip: boolean;
  following: Set<string>;
  inventory: GachaItem[];
  lastDailyClaim: number;
}

const profiles = new Map<string, Profile>();
const online = new Map<string, string>(); // socketId -> nickname

function getProfile(nickname: string, avatar = "🙂"): Profile {
  let p = profiles.get(nickname);
  if (!p) {
    p = {
      nickname,
      avatar,
      coins: 1000,
      vip: false,
      following: new Set(),
      inventory: [],
      lastDailyClaim: 0,
    };
    profiles.set(nickname, p);
  }
  return p;
}

function publicUser(p: Profile) {
  return { nickname: p.nickname, avatar: p.avatar, vip: p.vip };
}

// Seed bots so the app feels alive when testing alone.
const BOTS = [
  { nickname: "Luna", avatar: "🌙" },
  { nickname: "Kite", avatar: "🪁" },
  { nickname: "Mochi", avatar: "🍡" },
  { nickname: "Nova", avatar: "🌟" },
  { nickname: "Rin", avatar: "🎧" },
];
for (const b of BOTS) getProfile(b.nickname, b.avatar);

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

interface Post {
  id: number;
  author: string;
  avatar: string;
  text: string;
  ts: number;
  likes: Set<string>;
}

let postSeq = 1;
const posts: Post[] = [];

function addPost(author: string, text: string): Post {
  const p = getProfile(author);
  const post: Post = { id: postSeq++, author, avatar: p.avatar, text, ts: Date.now(), likes: new Set() };
  posts.push(post);
  return post;
}

addPost("Luna", "First night on Sora ✨ anyone up for a random call?");
addPost("Mochi", "Pulled a Legendary on my third gacha... I'm never this lucky 🐉");
addPost("Kite", "The music room is playing city pop tonight, come through 🎵");
addPost("Nova", "Reminder: be kind to strangers, you might make a friend 💜");
addPost("Rin", "3am thoughts hit different in Midnight Confessions 🌙");

function serializePost(post: Post, viewer: string | null) {
  const v = viewer ? profiles.get(viewer) : undefined;
  return {
    id: post.id,
    author: post.author,
    avatar: post.avatar,
    text: post.text,
    ts: post.ts,
    likes: post.likes.size,
    liked: viewer ? post.likes.has(viewer) : false,
    following: v ? v.following.has(post.author) : false,
    mine: viewer === post.author,
  };
}

// ---------------------------------------------------------------------------
// Group rooms
// ---------------------------------------------------------------------------

const ROOMS = [
  { id: "lounge", name: "Chill Lounge", icon: "🛋️", topic: "Late-night talks & good vibes" },
  { id: "music", name: "Music Corner", icon: "🎵", topic: "Share what you're listening to" },
  { id: "games", name: "Game Zone", icon: "🎮", topic: "Find a duo, talk games" },
  { id: "confess", name: "Midnight Confessions", icon: "🌙", topic: "Say what you can't say elsewhere" },
];

interface RoomMsg {
  id: number;
  author: string;
  avatar: string;
  text: string;
  ts: number;
}

let roomMsgSeq = 1;
const roomMessages = new Map<string, RoomMsg[]>(ROOMS.map((r) => [r.id, []]));

// ---------------------------------------------------------------------------
// Matchmaking (random chat / random call)
// ---------------------------------------------------------------------------

type Mode = "chat" | "call";
const queues: Record<Mode, string[]> = { chat: [], call: [] };
const sessions = new Map<string, { mode: Mode; peers: [string, string] }>();

// ---------------------------------------------------------------------------
// Gacha
// ---------------------------------------------------------------------------

const GACHA_POOL: Record<Rarity, { name: string; icon: string }[]> = {
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

function rollOnce(minRarity?: Rarity): GachaItem {
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
  return { rarity, ...pick(GACHA_POOL[rarity]) };
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
  res.writeHead(404).end();
});

const io = new Server(httpServer, { cors: { origin: true } });

function broadcastPresence() {
  const seen = new Set<string>();
  const users: any[] = [];
  for (const nickname of online.values()) {
    if (seen.has(nickname)) continue;
    seen.add(nickname);
    users.push({ ...publicUser(profiles.get(nickname)!), bot: false });
  }
  for (const b of BOTS) {
    if (!seen.has(b.nickname)) users.push({ ...publicUser(profiles.get(b.nickname)!), bot: true });
  }
  io.emit("presence", users);
}

function roomMembers(roomId: string) {
  const ids = io.sockets.adapter.rooms.get(`room:${roomId}`) ?? new Set();
  const members: any[] = [];
  for (const id of ids) {
    const nickname = online.get(id);
    if (nickname) members.push(publicUser(profiles.get(nickname)!));
  }
  return members;
}

function endSession(sessionId: string, exceptSocketId?: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  for (const id of session.peers) {
    if (id !== exceptSocketId) io.to(id).emit("session:ended", { sessionId });
    io.sockets.sockets.get(id)?.leave(sessionId);
  }
}

io.on("connection", (socket: Socket) => {
  let nick: string | null = null;

  const me = () => (nick ? profiles.get(nick) ?? null : null);

  socket.on("hello", ({ nickname, avatar }, ack) => {
    nick = String(nickname ?? "").trim().slice(0, 20) || "Guest";
    const p = getProfile(nick, avatar);
    if (typeof avatar === "string" && avatar) p.avatar = avatar;
    online.set(socket.id, nick);
    broadcastPresence();
    ack?.({ user: publicUser(p), coins: p.coins, vip: p.vip, inventory: p.inventory });
  });

  // --- matchmaking ---------------------------------------------------------

  socket.on("queue:join", ({ mode }: { mode: Mode }) => {
    if (mode !== "chat" && mode !== "call") return;
    const q = queues[mode];
    if (q.includes(socket.id)) return;
    const otherId = q.find((id) => id !== socket.id && online.has(id));
    if (!otherId) {
      q.push(socket.id);
      return;
    }
    q.splice(q.indexOf(otherId), 1);
    const sessionId = `s_${Math.random().toString(36).slice(2, 10)}`;
    sessions.set(sessionId, { mode, peers: [socket.id, otherId] });
    const other = io.sockets.sockets.get(otherId);
    socket.join(sessionId);
    other?.join(sessionId);
    const myProfile = me()!;
    const otherProfile = profiles.get(online.get(otherId)!)!;
    socket.emit("match:found", { sessionId, mode, role: "caller", peer: publicUser(otherProfile) });
    io.to(otherId).emit("match:found", { sessionId, mode, role: "callee", peer: publicUser(myProfile) });
  });

  socket.on("queue:leave", () => {
    for (const q of Object.values(queues)) {
      const i = q.indexOf(socket.id);
      if (i >= 0) q.splice(i, 1);
    }
  });

  socket.on("session:message", ({ sessionId, text }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.peers.includes(socket.id)) return;
    const t = String(text ?? "").slice(0, 500);
    if (!t) return;
    socket.to(sessionId).emit("session:message", { sessionId, text: t, ts: Date.now() });
  });

  socket.on("session:leave", ({ sessionId }) => endSession(sessionId, socket.id));

  socket.on("rtc:signal", ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (!session || !session.peers.includes(socket.id)) return;
    socket.to(sessionId).emit("rtc:signal", { sessionId, data });
  });

  // --- group rooms ---------------------------------------------------------

  socket.on("rooms:list", (ack) => {
    ack?.(ROOMS.map((r) => ({ ...r, members: roomMembers(r.id).length })));
  });

  socket.on("room:join", ({ roomId }, ack) => {
    const room = ROOMS.find((r) => r.id === roomId);
    if (!room) return ack?.(null);
    socket.join(`room:${roomId}`);
    ack?.({ room, messages: roomMessages.get(roomId), members: roomMembers(roomId) });
    io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
  });

  socket.on("room:leave", ({ roomId }) => {
    socket.leave(`room:${roomId}`);
    io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
  });

  socket.on("room:message", ({ roomId, text }) => {
    const p = me();
    const t = String(text ?? "").slice(0, 500);
    if (!p || !t || !roomMessages.has(roomId)) return;
    const msg: RoomMsg = { id: roomMsgSeq++, author: p.nickname, avatar: p.avatar, text: t, ts: Date.now() };
    const list = roomMessages.get(roomId)!;
    list.push(msg);
    if (list.length > 200) list.shift();
    io.to(`room:${roomId}`).emit("room:message", { roomId, message: msg });
  });

  // --- feed ----------------------------------------------------------------

  socket.on("feed:list", ({ tab }, ack) => {
    const p = me();
    let list = [...posts].sort((a, b) => b.ts - a.ts);
    if (tab === "following" && p) list = list.filter((x) => p.following.has(x.author));
    ack?.(list.map((x) => serializePost(x, nick)));
  });

  socket.on("feed:post", ({ text }, ack) => {
    const p = me();
    const t = String(text ?? "").trim().slice(0, 500);
    if (!p || !t) return ack?.(null);
    const post = addPost(p.nickname, t);
    io.emit("feed:new", { post: serializePost(post, null) });
    ack?.(serializePost(post, nick));
  });

  socket.on("feed:like", ({ id }, ack) => {
    const post = posts.find((x) => x.id === id);
    if (!post || !nick) return;
    post.likes.has(nick) ? post.likes.delete(nick) : post.likes.add(nick);
    ack?.({ id, likes: post.likes.size, liked: post.likes.has(nick) });
  });

  socket.on("user:follow", ({ nickname }, ack) => {
    const p = me();
    if (!p || !profiles.has(nickname) || nickname === nick) return;
    p.following.has(nickname) ? p.following.delete(nickname) : p.following.add(nickname);
    ack?.({ nickname, following: p.following.has(nickname) });
  });

  // --- gacha / economy -----------------------------------------------------

  socket.on("gacha:rates", (ack) => {
    ack?.(GACHA_RATES.map(([rarity, rate]) => ({ rarity, rate })));
  });

  socket.on("gacha:pull", ({ count }, ack) => {
    const p = me();
    if (!p) return;
    const n = count === 10 ? 10 : 1;
    const cost = n === 10 ? 900 : 100;
    if (p.coins < cost) return ack?.({ error: "Not enough coins" });
    p.coins -= cost;
    const results = Array.from({ length: n }, () => rollOnce());
    // 10-pull pity: guarantee at least one rare or better.
    if (n === 10 && results.every((r) => r.rarity === "common")) results[n - 1] = rollOnce("rare");
    p.inventory.push(...results);
    ack?.({ results, coins: p.coins, inventory: p.inventory });
  });

  socket.on("daily:claim", (ack) => {
    const p = me();
    if (!p) return;
    const DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - p.lastDailyClaim < DAY) return ack?.({ error: "Already claimed today", coins: p.coins });
    p.lastDailyClaim = Date.now();
    p.coins += p.vip ? 600 : 300;
    ack?.({ coins: p.coins });
  });

  socket.on("vip:activate", (ack) => {
    const p = me();
    if (!p) return;
    if (p.vip) return ack?.({ vip: true, coins: p.coins });
    if (p.coins < 800) return ack?.({ error: "Not enough coins (VIP costs 800)" });
    p.coins -= 800;
    p.vip = true;
    broadcastPresence();
    ack?.({ vip: true, coins: p.coins });
  });

  // --- disconnect ----------------------------------------------------------

  socket.on("disconnecting", () => {
    for (const q of Object.values(queues)) {
      const i = q.indexOf(socket.id);
      if (i >= 0) q.splice(i, 1);
    }
    for (const [sessionId, session] of sessions) {
      if (session.peers.includes(socket.id)) endSession(sessionId, socket.id);
    }
    const joinedRooms = [...socket.rooms].filter((r) => r.startsWith("room:"));
    online.delete(socket.id);
    // Membership updates fire after the socket actually leaves.
    setImmediate(() => {
      for (const r of joinedRooms) io.to(r).emit("room:members", { roomId: r.slice(5), members: roomMembers(r.slice(5)) });
      broadcastPresence();
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[sora] server listening on http://localhost:${PORT}`);
});
