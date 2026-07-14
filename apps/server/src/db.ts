import Database from "better-sqlite3";

// File-based SQLite: persists locally across restarts. On Render's free tier
// the disk is ephemeral, so the DB resets on redeploy/spin-down — move to a
// persistent disk or hosted Postgres in phase 1.
export const db = new Database(process.env.DB_PATH ?? "sora.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    nickname TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '🙂',
    coins INTEGER NOT NULL DEFAULT 1000,
    vip INTEGER NOT NULL DEFAULT 0,
    last_daily INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower INTEGER NOT NULL,
    followee INTEGER NOT NULL,
    PRIMARY KEY (follower, followee)
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS likes (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    rarity TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dms (
    id INTEGER PRIMARY KEY,
    sender INTEGER NOT NULL REFERENCES users(id),
    recipient INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    ts INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_dms_pair ON dms (sender, recipient, ts);
  CREATE INDEX IF NOT EXISTS idx_dms_recipient ON dms (recipient, read);
`);

export interface UserRow {
  id: number;
  email: string | null;
  password_hash: string | null;
  google_id: string | null;
  nickname: string;
  avatar: string;
  coins: number;
  vip: number;
  last_daily: number;
}

export function publicUser(u: UserRow) {
  return { id: u.id, nickname: u.nickname, avatar: u.avatar, vip: !!u.vip };
}

export const getUserById = db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?");
export const getUserByEmail = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?");
export const getUserByGoogleId = db.prepare<[string], UserRow>("SELECT * FROM users WHERE google_id = ?");

// Seed a handful of authors + posts so the feed isn't empty on first run.
if ((db.prepare("SELECT COUNT(*) c FROM posts").get() as any).c === 0) {
  const seedUser = db.prepare(
    "INSERT INTO users (email, nickname, avatar, created) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING"
  );
  const seedPost = db.prepare("INSERT INTO posts (user_id, text, ts) VALUES (?, ?, ?)");
  const seeds: [string, string, string, string][] = [
    ["luna@seed.sora", "Luna", "🌙", "First night on Sora ✨ anyone up for a random call?"],
    ["mochi@seed.sora", "Mochi", "🍡", "Pulled a Legendary on my third gacha... I'm never this lucky 🐉"],
    ["kite@seed.sora", "Kite", "🪁", "Made a music room tonight, come through 🎵"],
    ["nova@seed.sora", "Nova", "🌟", "Reminder: be kind to strangers, you might make a friend 💜"],
  ];
  const now = Date.now();
  seeds.forEach(([email, nickname, avatar, text], i) => {
    seedUser.run(email, nickname, avatar, now);
    const u = getUserByEmail.get(email);
    if (u) seedPost.run(u.id, text, now - (seeds.length - i) * 3600_000);
  });
}
