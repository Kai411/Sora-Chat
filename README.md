# Sora 🪽

A cross-platform social app in the spirit of Soul Chat (Global): random chat, random voice calls, user-created group rooms, DMs, a social feed, gacha, and VIP.

**Strategy:** web-first → wrap with [Capacitor](https://capacitorjs.com) for iOS/Android → optional Electron/Tauri for desktop. One Vue codebase everywhere; payments, push, and calls sit behind swappable layers so native plugins drop in without refactoring.

## Quick start

```sh
nvm use          # Node 22 (see .nvmrc — Node 18 is too old for Vite/Tailwind v4)
npm install
npm run dev      # server on :3001 + web on :5173
```

Open http://localhost:5173. To test social features solo, create a **second account in a private window** (the matchmaker never pairs two tabs of the same account).

**Test from your phone:** join the same Wi-Fi and open `http://<laptop-ip>:5173`. For anything using the mic off-localhost you need HTTPS: `npm run dev:https --workspace apps/web` and accept the self-signed cert warning.

## What's built

| Feature | Status |
|---|---|
| Accounts | ✅ email+password (scrypt) + session tokens, SQLite-persisted |
| Google login | ✅ wired, shown when `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` are set |
| Main hub + online users | ✅ live presence; tap a user to DM them |
| Direct messages | ✅ IG-style: conversation list, unread counts, live delivery, persisted |
| DM voice calls | ✅ ring / accept / decline flow, WebRTC P2P audio |
| Random chat / random call | ✅ matchmaking queue, skip/next, WebRTC audio |
| Group rooms | ✅ user-created, live while occupied, text chat + member list |
| Minimized rooms | ✅ leave the page, stay in the room — dock pill with unread badge; call features force-leave |
| Feed | ✅ public/following tabs, posts, likes, follow — persisted |
| Gacha / economy | ✅ server-authoritative, disclosed rates, 10-pull pity, persisted inventory/coins |
| VIP | ✅ mock (coins), double daily bonus |

Persistence is **SQLite** (`apps/server/sora.db`, auto-created). Zero installs locally; on Render's free tier the disk is ephemeral, so the DB resets on redeploys — move to a persistent disk or hosted Postgres for real usage.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `VITE_SERVER_URL` | web build (Netlify) | Socket.IO server origin; defaults to same-origin |
| `VITE_GOOGLE_CLIENT_ID` | web build | shows the Google Sign-In button |
| `GOOGLE_CLIENT_ID` | server | verifies Google ID tokens (same OAuth client ID) |
| `DB_PATH` | server | SQLite file location (default `sora.db`) |
| `PORT` | server | default 3001 |

Google setup: Google Cloud console → create an OAuth 2.0 **Web application** client → add your Netlify domain (and `http://localhost:5173`) to *Authorized JavaScript origins* → use the client ID for both vars above.

## Architecture

```
apps/
  web/      Vue 3 + Vite + TS + Pinia + Tailwind v4
    src/lib/socket.ts    single Socket.IO client (VITE_SERVER_URL for prod/Capacitor)
    src/lib/webrtc.ts    P2P call setup (callee-ready handshake, then offer/answer/ICE)
    src/stores/          app (auth/session), room (docked room), call (DM call signaling)
    src/views/           one view per feature
  server/   Node + Socket.IO (tsx)
    src/db.ts            SQLite schema + seeds (better-sqlite3)
    src/auth.ts          scrypt passwords, session tokens, Google token verification
    src/index.ts         socket handlers: presence, matchmaking, rooms, DMs, feed, gacha
```

All traffic uses Socket.IO (acks as RPC). Deploys: web on Netlify (`netlify.toml`), server on Render (`render.yaml`).

## Roadmap

- **Phase 1 — production backend:** hosted Postgres (or Render persistent disk), rate limiting, moderation basics (block/report — required by app stores for UGC apps), password reset emails.
- **Phase 2 — group audio:** LiveKit SFU for voice rooms; TURN server for NAT-blocked P2P calls.
- **Phase 3 — Capacitor wrap:** iOS/Android shells, push notifications (FCM/APNs), RevenueCat for gacha/VIP IAP (StoreKit/Play Billing; Stripe stays on web).
- **Phase 4 — native call polish:** background audio, CallKit/ConnectionService, audio routing.
- **Phase 5 — desktop (optional):** Electron or Tauri wrap of the same build.
