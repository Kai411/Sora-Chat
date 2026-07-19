// Entry point: restore the db snapshot from Supabase Storage BEFORE index.ts
// imports db.ts (which opens the SQLite file at import time).
import "./env";
import { restoreSnapshot } from "./persist";

await restoreSnapshot(process.env.DB_PATH ?? "sora.db");
await import("./index");
