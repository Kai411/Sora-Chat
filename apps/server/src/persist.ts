import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type DatabaseType from "better-sqlite3";

// Persistence via Supabase Storage (survives Render's ephemeral disk):
//  - the SQLite db is restored from a private bucket on boot and snapshotted
//    back whenever it changes (45s loop + on shutdown)
//  - uploaded media (images, music) goes to a public bucket and is served
//    from Supabase's CDN directly
// Requires SUPABASE_SERVICE_KEY (service_role). Without it, everything falls
// back to the local disk exactly as before — safe for local dev.

const DATA_BUCKET = "sora-data";
const MEDIA_BUCKET = "sora-media";
const DB_OBJECT = "sora.db";

let client: SupabaseClient | null = null;

function storage(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const persistenceEnabled = () => !!storage();

async function ensureBuckets(c: SupabaseClient) {
  // createBucket errors if it already exists — that's fine.
  await c.storage.createBucket(DATA_BUCKET, { public: false }).catch(() => {});
  await c.storage.createBucket(MEDIA_BUCKET, { public: true }).catch(() => {});
}

/** Pull the latest db snapshot down before better-sqlite3 opens the file. */
export async function restoreSnapshot(dbPath: string) {
  const c = storage();
  if (!c) {
    console.log("[persist] disabled — no SUPABASE_SERVICE_KEY; using local disk only");
    return;
  }
  try {
    await ensureBuckets(c);
    const { data, error } = await c.storage.from(DATA_BUCKET).download(DB_OBJECT);
    if (error || !data) {
      console.log("[persist] no db snapshot in storage yet (fresh start)");
      return;
    }
    writeFileSync(dbPath, Buffer.from(await data.arrayBuffer()));
    console.log("[persist] restored db snapshot from Supabase Storage");
  } catch (e: any) {
    console.error("[persist] restore failed:", e?.message ?? e);
  }
}

let lastHash = "";
let flushing = false;

async function flush(db: DatabaseType.Database) {
  const c = storage();
  if (!c || flushing) return;
  flushing = true;
  try {
    const buf = db.serialize();
    const hash = createHash("sha1").update(buf).digest("hex");
    if (hash !== lastHash) {
      const { error } = await c.storage
        .from(DATA_BUCKET)
        .upload(DB_OBJECT, buf, { upsert: true, contentType: "application/octet-stream" });
      if (error) console.error("[persist] snapshot upload failed:", error.message);
      else lastHash = hash;
    }
  } catch (e: any) {
    console.error("[persist] flush error:", e?.message ?? e);
  } finally {
    flushing = false;
  }
}

/** Snapshot the db to Storage every 45s when it changed, and on shutdown. */
export function startSnapshotLoop(db: DatabaseType.Database) {
  if (!storage()) return;
  setInterval(() => void flush(db), 45_000);
  const onExit = async () => {
    await flush(db);
    process.exit(0);
  };
  process.once("SIGTERM", onExit);
  process.once("SIGINT", onExit);
  void flush(db); // baseline right away
  console.log("[persist] snapshot loop running (45s)");
}

/** Store a media file in the public bucket; returns its CDN URL, or null. */
export async function uploadMedia(path: string, buf: Buffer, contentType: string): Promise<string | null> {
  const c = storage();
  if (!c) return null;
  try {
    const { error } = await c.storage.from(MEDIA_BUCKET).upload(path, buf, { contentType, upsert: false });
    if (error) {
      console.error("[persist] media upload failed:", error.message);
      return null;
    }
    return c.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e: any) {
    console.error("[persist] media upload error:", e?.message ?? e);
    return null;
  }
}
