import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when env isn't configured — the login screen explains what's missing. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/**
 * Synchronous "probably signed in" check for the router guard; supabase-js
 * persists its session under sb-<project-ref>-auth-token.
 */
export function hasStoredSession(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
  }
  return false;
}
