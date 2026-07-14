import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { db, getUserById, publicUser, type UserRow } from "./db";
import { createSession, endSessionToken, loginEmail, loginGoogle, register, resumeSession } from "./auth";

const PORT = Number(process.env.PORT) || 3001;

// ---------------------------------------------------------------------------
// Live (non-persisted) state: presence, rooms, matchmaking, call sessions.
// ---------------------------------------------------------------------------

const online = new Map<string, number>(); // socketId -> userId

interface LiveRoom {
  id: string;
  name: string;
  icon: string;
  topic: string;
  creator: ReturnType<typeof publicUser>;
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
// Gacha
// ---------------------------------------------------------------------------

type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

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

function rollOnce(minRarity?: Rarity) {
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
// Prepared statements
// ---------------------------------------------------------------------------

const setCoins = db.prepare("UPDATE users SET coins = ? WHERE id = ?");
const setVip = db.prepare("UPDATE users SET vip = 1 WHERE id = ?");
const setDaily = db.prepare("UPDATE users SET last_daily = ?, coins = ? WHERE id = ?");
const setAvatar = db.prepare("UPDATE users SET avatar = ? WHERE id = ?");
const addInventory = db.prepare("INSERT INTO inventory (user_id, name, icon, rarity) VALUES (?, ?, ?, ?)");
const listInventory = db.prepare("SELECT name, icon, rarity FROM inventory WHERE user_id = ?");

const insertPost = db.prepare("INSERT INTO posts (user_id, text, ts) VALUES (?, ?, ?)");
const likeStmt = db.prepare("INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)");
const unlikeStmt = db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?");
const hasLike = db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?");
const followStmt = db.prepare("INSERT OR IGNORE INTO follows (follower, followee) VALUES (?, ?)");
const unfollowStmt = db.prepare("DELETE FROM follows WHERE follower = ? AND followee = ?");
const hasFollow = db.prepare("SELECT 1 FROM follows WHERE follower = ? AND followee = ?");

const FEED_SELECT = `
  SELECT p.id, p.text, p.ts, p.user_id AS userId, u.nickname AS author, u.avatar,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @viewer) AS liked,
    EXISTS(SELECT 1 FROM follows f WHERE f.follower = @viewer AND f.followee = p.user_id) AS following
  FROM posts p JOIN users u ON u.id = p.user_id`;
const feedPublic = db.prepare(`${FEED_SELECT} ORDER BY p.ts DESC LIMIT 100`);
const feedFollowing = db.prepare(
  `${FEED_SELECT} WHERE EXISTS(SELECT 1 FROM follows f WHERE f.follower = @viewer AND f.followee = p.user_id)
   ORDER BY p.ts DESC LIMIT 100`
);
const getPostRow = db.prepare(`${FEED_SELECT} WHERE p.id = @id`);

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

const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e5 });

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

function closeRoomIfEmpty(roomId: string) {
  const occupied = io.sockets.adapter.rooms.get(`room:${roomId}`)?.size ?? 0;
  if (!occupied && rooms.has(roomId)) {
    rooms.delete(roomId);
    roomMessages.delete(roomId);
  }
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

  function authOk(u: UserRow, ack: any, token?: string) {
    user = u;
    online.set(socket.id, u.id);
    broadcastPresence();
    ack?.({
      token: token ?? null,
      user: publicUser(u),
      coins: u.coins,
      vip: !!u.vip,
      inventory: listInventory.all(u.id),
    });
  }

  // --- auth ----------------------------------------------------------------

  socket.on("auth:register", ({ email, password, nickname, avatar }, ack) => {
    const res = register(String(email ?? ""), String(password ?? ""), String(nickname ?? ""), String(avatar ?? "🙂"));
    if ("error" in res) return ack?.({ error: res.error });
    if (avatar) setAvatar.run(String(avatar), res.user.id);
    authOk(getUserById.get(res.user.id)!, ack, createSession(res.user.id));
  });

  socket.on("auth:login", ({ email, password }, ack) => {
    const res = loginEmail(String(email ?? ""), String(password ?? ""));
    if ("error" in res) return ack?.({ error: res.error });
    authOk(res.user, ack, createSession(res.user.id));
  });

  socket.on("auth:google", async ({ idToken }, ack) => {
    const res = await loginGoogle(String(idToken ?? ""));
    if ("error" in res) return ack?.({ error: res.error });
    authOk(res.user, ack, createSession(res.user.id));
  });

  socket.on("auth:resume", ({ token }, ack) => {
    const u = resumeSession(String(token ?? ""));
    if (!u) return ack?.({ error: "Session expired — please sign in again" });
    authOk(u, ack);
  });

  socket.on("auth:logout", ({ token }) => {
    if (token) endSessionToken(String(token));
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

  // --- user-created rooms ----------------------------------------------------

  socket.on("rooms:create", ({ name, icon, topic }, ack) => {
    if (!user) return;
    const n = String(name ?? "").trim().slice(0, 30);
    if (!n) return ack?.({ error: "Give your room a name" });
    const room: LiveRoom = {
      id: `r_${randomUUID().slice(0, 8)}`,
      name: n,
      icon: String(icon ?? "🎪").slice(0, 4),
      topic: String(topic ?? "").trim().slice(0, 60),
      creator: publicUser(user),
    };
    rooms.set(room.id, room);
    roomMessages.set(room.id, []);
    ack?.({ room });
  });

  socket.on("rooms:list", (ack) => {
    ack?.([...rooms.values()].map((r) => ({ ...r, members: roomMembers(r.id).length })));
  });

  socket.on("room:join", ({ roomId }, ack) => {
    const room = rooms.get(roomId);
    if (!user || !room) return ack?.(null);
    socket.join(`room:${roomId}`);
    ack?.({ room, messages: roomMessages.get(roomId), members: roomMembers(roomId) });
    io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
  });

  socket.on("room:leave", ({ roomId }) => {
    socket.leave(`room:${roomId}`);
    io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
    closeRoomIfEmpty(roomId);
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

  socket.on("feed:post", ({ text }, ack) => {
    const t = String(text ?? "").trim().slice(0, 500);
    if (!user || !t) return ack?.(null);
    const info = insertPost.run(user.id, t, Date.now());
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

  socket.on("user:follow", ({ userId }, ack) => {
    const target = getUserById.get(Number(userId));
    if (!user || !target || target.id === user.id) return;
    if (hasFollow.get(user.id, target.id)) unfollowStmt.run(user.id, target.id);
    else followStmt.run(user.id, target.id);
    ack?.({ userId: target.id, following: !!hasFollow.get(user.id, target.id) });
  });

  // --- gacha / economy -----------------------------------------------------------

  socket.on("gacha:rates", (ack) => {
    ack?.(GACHA_RATES.map(([rarity, rate]) => ({ rarity, rate })));
  });

  socket.on("gacha:pull", ({ count }, ack) => {
    const u = refresh();
    if (!u) return;
    const n = count === 10 ? 10 : 1;
    const cost = n === 10 ? 900 : 100;
    if (u.coins < cost) return ack?.({ error: "Not enough coins" });
    const results = Array.from({ length: n }, () => rollOnce());
    // 10-pull pity: guarantee at least one rare or better.
    if (n === 10 && results.every((r) => r.rarity === "common")) results[n - 1] = rollOnce("rare");
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
      for (const roomId of joinedRooms) {
        io.to(`room:${roomId}`).emit("room:members", { roomId, members: roomMembers(roomId) });
        closeRoomIfEmpty(roomId);
      }
      broadcastPresence();
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[sora] server listening on http://localhost:${PORT}`);
});
