# Sora 🪽

A cross-platform social app in the spirit of Soul Chat (Global): random chat, random voice calls, group rooms, a social feed, gacha, and VIP.

**Strategy:** web-first → wrap with [Capacitor](https://capacitorjs.com) for iOS/Android → optional Electron/Tauri for desktop. One Vue codebase everywhere; payments, push, and calls sit behind swappable layers so native plugins drop in without refactoring.

## Quick start

```sh
nvm use          # Node 22 (see .nvmrc — Node 18 is too old for Vite/Tailwind v4)
npm install
npm run dev      # server on :3001 + web on :5173
```

Open http://localhost:5173 — open a **second tab** (or private window) with a different nickname to match with yourself in Random Chat / Random Call.

**Test from your phone:** join the same Wi-Fi and open `http://<laptop-ip>:5173`. For the random *call* (mic access) off-localhost you need HTTPS: run `npm run dev:https --workspace apps/web` and accept the self-signed cert warning on the phone.

## What's in the prototype

| Feature | Status |
|---|---|
| Login (nickname + avatar) | ✅ guest-style, persisted locally |
| Main hub + online users | ✅ live presence (seeded bots keep it lively) |
| Random chat | ✅ server-side matchmaking queue, skip/next |
| Random call | ✅ real WebRTC P2P audio, signaled via Socket.IO |
| Group rooms | ✅ text chat + live member list (audio: phase 2) |
| Feed | ✅ public/following tabs, posts, likes, follow |
| Gacha | ✅ server-side rolls, disclosed rates, 10-pull pity, inventory |
| VIP | ✅ mock (bought with coins), double daily bonus |
| Economy | ✅ coins, daily claim — all server-authoritative |

Everything is **in-memory** on the server — restart wipes state. That's deliberate: zero installs beyond Node, and the entire persistence layer is contained in the top section of `apps/server/src/index.ts` for a clean swap to Postgres/Redis.

## Architecture

```
apps/
  web/      Vue 3 + Vite + TS + Pinia + Tailwind v4
    src/lib/socket.ts    single Socket.IO client (same-origin; VITE_SERVER_URL for Capacitor)
    src/lib/webrtc.ts    P2P call setup (callee-ready handshake, then offer/answer/ICE)
    src/stores/app.ts    session: user, coins, inventory, presence
    src/views/           one view per feature
  server/   Node + Socket.IO (tsx), all state in-memory
```

All realtime + request/response traffic uses Socket.IO (acks as RPC). The vite dev server proxies `/socket.io` to `:3001`, so the client is same-origin in dev and prod.

## Roadmap

- **Phase 1 — real backend:** Postgres (profiles, posts, inventory, ledger) + Redis (presence, matchmaking queues), real auth (phone/OAuth), moderation basics (block/report — required by app stores for UGC apps).
- **Phase 2 — group audio:** LiveKit SFU for audio rooms; keep P2P for 1:1 calls, add TURN server for NAT-blocked users.
- **Phase 3 — Capacitor wrap:** iOS/Android shells, `@capacitor/push-notifications` (FCM/APNs), RevenueCat for gacha/VIP IAP (StoreKit/Play Billing — required for digital goods; Stripe stays for web), gacha odds disclosure screen (store policy; already have `gacha:rates`).
- **Phase 4 — native call polish:** background audio mode, CallKit/ConnectionService via `capacitor-callkit-voip`, audio routing.
- **Phase 5 — desktop (optional):** Electron or Tauri wrap of the same build.
