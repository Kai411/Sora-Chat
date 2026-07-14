import { db, getUserById, type UserRow } from "./db";

const bySupabaseId = db.prepare<[string], UserRow>("SELECT * FROM users WHERE supabase_id = ?");
const insertUser = db.prepare(
  "INSERT INTO users (supabase_id, email, nickname, avatar, created) VALUES (?, ?, ?, ?, ?)"
);

type AuthResult = { user: UserRow } | { error: string };

/**
 * Verifies a Supabase access token against the project's auth API, then maps
 * it to (or creates) the local Sora profile row. Nickname/avatar for new
 * users come from signup metadata, the auth:supabase payload, or the email.
 */
export async function verifySupabaseToken(
  accessToken: string,
  extra?: { nickname?: string; avatar?: string }
): Promise<AuthResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { error: "Supabase is not configured on the server (SUPABASE_URL / SUPABASE_ANON_KEY)" };
  if (!accessToken) return { error: "Missing access token" };

  let sb: any;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { error: "Invalid or expired session — please sign in again" };
    sb = await res.json();
  } catch {
    return { error: "Could not reach the auth service" };
  }
  if (!sb?.id) return { error: "Invalid auth response" };

  const existing = bySupabaseId.get(sb.id);
  if (existing) return { user: existing };

  const meta = sb.user_metadata ?? {};
  const email: string | null = sb.email ?? null;
  const nickname = String(extra?.nickname || meta.nickname || meta.full_name || email?.split("@")[0] || "Soran")
    .trim()
    .slice(0, 20);
  const avatar = String(extra?.avatar || meta.avatar || "🙂").slice(0, 4);
  const info = insertUser.run(sb.id, email, nickname || "Soran", avatar, Date.now());
  return { user: getUserById.get(Number(info.lastInsertRowid))! };
}
