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
| Accounts | ✅ Supabase Auth (email+password, managed sessions, password-reset emails) |
| Google login | ✅ via Supabase — toggle the Google provider in the Supabase dashboard |
| Main hub + online users | ✅ live presence; tap a user to DM them |
| Direct messages | ✅ IG-style: conversation list, unread counts, live delivery, persisted |
| DM voice calls | ✅ ring / accept / decline flow, WebRTC P2P audio |
| Random chat / random call | ✅ matchmaking queue, skip/next, WebRTC audio |
| Party rooms | ✅ user-created with categories (Music/Private/Chat), optional 4-digit PIN lock, 10-seat stage (2×5): request→host approves, host invites to seats, mute states, max-2 admins, host transfer |
| Party-room live audio | ✅ via LiveKit — seated users speak, everyone listens; needs `LIVEKIT_*` env (free tier at cloud.livekit.io), shows "not configured" otherwise |
| Minimized rooms | ✅ leave the page, stay in the room — dock pill with unread badge; call features force-leave |
| Feed | ✅ public/following tabs, photo posts, comments, likes, follow, own posts on profile — persisted |
| Gacha / economy | ✅ multiple banners with per-banner pools/pages, disclosed rates, 10-pull pity, persisted inventory/coins |
| VIP | ✅ mock (coins), double daily bonus |
| Navigation | ✅ Home · Feed · Rooms · Chat (all DMs) · Me; gacha via Home |

Persistence is **SQLite** (`apps/server/sora.db`, auto-created). Zero installs locally; on Render's free tier the disk is ephemeral, so the DB resets on redeploys — move to a persistent disk or hosted Postgres for real usage.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `VITE_SERVER_URL` | web build (Netlify) | Socket.IO server origin; defaults to same-origin |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | web build | Supabase project URL + anon key (Settings → API) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | server | same project; used to verify user access tokens |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | server | party-room audio — LiveKit Cloud free tier, or self-host via [infra/livekit/](infra/livekit/README.md) |
| `DB_PATH` | server | SQLite file location (default `sora.db`) |
| `PORT` | server | default 3001 |

Supabase setup: create a free project at supabase.com → Settings → API gives the URL + anon key (put in all four vars above). For instant signups during development, turn off **Authentication → Sign In / Providers → Email → Confirm email**. For Google login, enable the Google provider in the same screen (that one still needs a Google Cloud OAuth client ID + secret pasted into Supabase, plus Supabase's callback URL registered in Google).

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
    src/auth.ts          Supabase access-token verification → local profile row
    src/index.ts         socket handlers: presence, matchmaking, rooms, DMs, feed, gacha
```

All traffic uses Socket.IO (acks as RPC). Deploys: web on Netlify (`netlify.toml`), server on Render (`render.yaml`).

## Roadmap

**Next feature iteration** (spec, not yet built): party rooms with audio seats, nav rework (Chat tab replaces Gacha), multi-banner gacha, photo posts + comments. See [PLANNING.md](PLANNING.md).

- **Phase 1 — production backend:** move app data from SQLite to Supabase Postgres (auth is already Supabase), rate limiting, moderation basics (block/report — required by app stores for UGC apps).
- **Phase 2 — call hardening:** TURN server for NAT-blocked P2P calls (room audio ships via LiveKit already).
- **Phase 3 — Capacitor wrap:** iOS/Android shells, push notifications (FCM/APNs), RevenueCat for gacha/VIP IAP (StoreKit/Play Billing; Stripe stays on web).
- **Phase 4 — native call polish:** background audio, CallKit/ConnectionService, audio routing.
- **Phase 5 — desktop (optional):** Electron or Tauri wrap of the same build.
