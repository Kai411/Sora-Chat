import Database from "better-sqlite3";

// File-based SQLite: persists locally across restarts. On Render's free tier
// the disk is ephemeral, so the DB resets on redeploy/spin-down — move to a
// persistent disk or hosted Postgres in phase 1.
export const db = new Database(process.env.DB_PATH ?? "sora.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    supabase_id TEXT,
    email TEXT UNIQUE,
    nickname TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '🙂',
    coins INTEGER NOT NULL DEFAULT 3000,
    vip INTEGER NOT NULL DEFAULT 0,
    last_daily INTEGER NOT NULL DEFAULT 0,
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
    image TEXT,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, ts);
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
  CREATE TABLE IF NOT EXISTS visits (
    visitor INTEGER NOT NULL REFERENCES users(id),
    visited INTEGER NOT NULL REFERENCES users(id),
    ts INTEGER NOT NULL,
    PRIMARY KEY (visitor, visited)
  );
  CREATE TABLE IF NOT EXISTS avatar_owned (
    user_id INTEGER NOT NULL REFERENCES users(id),
    avatar_id TEXT NOT NULL,
    PRIMARY KEY (user_id, avatar_id)
  );
  CREATE TABLE IF NOT EXISTS cosmetics_owned (
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    src TEXT NOT NULL,
    PRIMARY KEY (user_id, type, src)
  );
`);

// Migrate older dev databases in place (throwaway data, but don't crash).
try {
  db.exec("ALTER TABLE users ADD COLUMN supabase_id TEXT");
} catch {}
try {
  db.exec("ALTER TABLE posts ADD COLUMN image TEXT");
} catch {}
for (const col of ["frame", "bubble", "pet", "profile_bg", "banner"]) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  } catch {}
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase ON users (supabase_id)");

export interface UserRow {
  id: number;
  supabase_id: string | null;
  email: string | null;
  nickname: string;
  avatar: string;
  coins: number;
  vip: number;
  last_daily: number;
  frame: string | null;
  bubble: string | null;
  pet: string | null;
  profile_bg: string | null;
  banner: string | null;
}

export function publicUser(u: UserRow) {
  return { id: u.id, nickname: u.nickname, avatar: u.avatar, vip: !!u.vip, frame: u.frame ?? null, pet: u.pet ?? null };
}

export const getUserById = db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?");
export const getUserByEmail = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?");

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
