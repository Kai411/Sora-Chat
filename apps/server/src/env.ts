// Imported first so .env is loaded before any module reads process.env
// (ESM imports hoist above inline statements). Hosted envs inject vars
// directly; missing file is fine.
try {
  process.loadEnvFile();
} catch {}
