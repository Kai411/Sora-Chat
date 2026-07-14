import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db, getUserByEmail, getUserByGoogleId, getUserById, type UserRow } from "./db";

const insertUser = db.prepare(
  "INSERT INTO users (email, password_hash, google_id, nickname, avatar, created) VALUES (?, ?, ?, ?, ?, ?)"
);
const insertSession = db.prepare("INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)");
const getSession = db.prepare<[string], { user_id: number }>("SELECT user_id FROM sessions WHERE token = ?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, "hex"));
}

export function createSession(userId: number): string {
  const token = randomUUID();
  insertSession.run(token, userId, Date.now());
  return token;
}

export function resumeSession(token: string): UserRow | null {
  const row = getSession.get(token);
  return row ? getUserById.get(row.user_id) ?? null : null;
}

export function endSessionToken(token: string) {
  deleteSession.run(token);
}

type AuthResult = { user: UserRow } | { error: string };

export function register(email: string, password: string, nickname: string, avatar: string): AuthResult {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  if (!nickname.trim()) return { error: "Pick a nickname" };
  if (getUserByEmail.get(email)) return { error: "That email is already registered" };
  const info = insertUser.run(email, hashPassword(password), null, nickname.trim().slice(0, 20), avatar, Date.now());
  return { user: getUserById.get(Number(info.lastInsertRowid))! };
}

export function loginEmail(email: string, password: string): AuthResult {
  const user = getUserByEmail.get(email.trim().toLowerCase());
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    return { error: "Wrong email or password" };
  }
  return { user };
}

/**
 * Verifies a Google ID token via Google's tokeninfo endpoint (prototype-grade;
 * swap for local JWKS verification with google-auth-library at scale).
 * Requires GOOGLE_CLIENT_ID so tokens minted for other apps are rejected.
 */
export async function loginGoogle(idToken: string): Promise<AuthResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return { error: "Google login is not configured on this server" };
  let payload: any;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return { error: "Google rejected the sign-in token" };
    payload = await res.json();
  } catch {
    return { error: "Could not verify the Google token" };
  }
  if (payload.aud !== clientId) return { error: "Google token was issued for a different app" };

  const existing = getUserByGoogleId.get(payload.sub);
  if (existing) return { user: existing };
  // Link to an existing email/password account if the address matches.
  const email = (payload.email ?? "").toLowerCase();
  const byEmail = email ? getUserByEmail.get(email) : undefined;
  if (byEmail) {
    db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(payload.sub, byEmail.id);
    return { user: getUserById.get(byEmail.id)! };
  }
  const nickname = (payload.given_name || payload.name || email.split("@")[0] || "Soran").slice(0, 20);
  const info = insertUser.run(email || null, null, payload.sub, nickname, "🙂", Date.now());
  return { user: getUserById.get(Number(info.lastInsertRowid))! };
}
