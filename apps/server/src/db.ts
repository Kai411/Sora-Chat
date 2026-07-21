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
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (visitor, visited)
  );
  -- VIP goes incognito for a specific person: hider is hidden from hidden_from's visitor list.
  CREATE TABLE IF NOT EXISTS visit_hides (
    hider INTEGER NOT NULL REFERENCES users(id),
    hidden_from INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (hider, hidden_from)
  );
  -- watcher is notified when watched visits watcher's profile.
  CREATE TABLE IF NOT EXISTS visit_watch (
    watcher INTEGER NOT NULL REFERENCES users(id),
    watched INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (watcher, watched)
  );
  -- guest is notified when host opens a party room.
  CREATE TABLE IF NOT EXISTS party_reminders (
    guest INTEGER NOT NULL REFERENCES users(id),
    host INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (guest, host)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    actor_id INTEGER,
    room_id TEXT,
    ts INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, ts);
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
  CREATE TABLE IF NOT EXISTS music (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    src TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_music_user ON music (user_id);
  CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    src TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shop_type ON shop_items (type);
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
try {
  db.exec("ALTER TABLE music ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
} catch {}
try {
  db.exec("ALTER TABLE visits ADD COLUMN count INTEGER NOT NULL DEFAULT 1");
} catch {}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase ON users (supabase_id)");

// One-time cleanup: earlier builds seeded placeholder feed posts under
// @seed.sora accounts. Remove any leftovers on existing databases (harmless
// no-op once cleaned, including on fresh dbs with no seed accounts).
try {
  const seedUsers = db.prepare("SELECT id FROM users WHERE email LIKE '%@seed.sora'").all() as { id: number }[];
  if (seedUsers.length) {
    const ids = seedUsers.map((u) => u.id);
    const ph = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`).run(...ids);
    db.prepare(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${ph}))`).run(...ids);
    db.prepare(`DELETE FROM posts WHERE user_id IN (${ph})`).run(...ids);
  }
} catch {}

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

// No seeded content — the feed starts empty; real users fill it.
