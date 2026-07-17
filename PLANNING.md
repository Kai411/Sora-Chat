# Sora — Planned Features (next iteration)

Status: **built 2026-07-17** (captured 2026-07-15), with one deliberate exception: party-room **audio streams** are deferred to the LiveKit phase (the SDK install was declined for now) — seats, PIN locks, roles, and mute states are all live, but no voice flows between seats yet. Open questions at the bottom remain open.

---

## 1. Party rooms (major rework of current text rooms)

Today's rooms are text-only. This turns them into audio "party rooms" with a seat/stage model (Soul-Chat / live-audio style).

### Creation
- **Fixed room categories**, each prepends a text prefix to the room name:
  1. **Music Room**
  2. **Private Room**
  3. **Chat Room**
  - (Creator types the rest of the name; final display = `<Category> · <name>` or similar.)
- **Lockable room** with a **4-digit PIN**. Non-members must enter the PIN to join.
  - **Future:** locked rooms become a **VIP-reserved** capability (gate the lock toggle behind VIP).

### Seats / stage
- Room shows **10 seats**, laid out **2 rows × 5 columns** (interpretation of "Row of 2, 5 Columns" — confirm).
- A listener can **request a specific seat**; the **host approves** the request.
- A user **on a seat can speak** via mic, with per-seat controls (**mute/unmute**, at minimum).
- Listeners (not on a seat) are in the room but audio-muted / receive-only.

### Roles & moderation
- **Host** (room creator) can:
  - **Invite** a user up onto a seat directly.
  - **Promote** a user to **admin** — **max 2 admins per room**.
- Admins share seat/kick/invite controls (scope TBD).

### Dependencies / notes
- Audio seats require an **SFU — LiveKit** (already Roadmap phase 2). Seat state (who's on which seat, mute status) is app state synced over Socket.IO; the actual audio streams go through LiveKit tracks.
- Seat map, PIN, roles → need to persist per live room (currently rooms are in-memory and close when empty; decide whether party rooms persist).
- **Open questions:** exact admin permissions; whether rooms outlive an empty state; seat layout confirmation.

---

## 2. Bottom navigation

- **Remove the Gacha tab.** Replace it with a **Chat** tab.
- **Chat tab shows all chats** — merges the current DM list (💌) into a first-class nav destination. (Gacha remains reachable, e.g. from Home feature cards — see §3.)
- Resulting tabs (proposed): **Home · Feed · Rooms · Chat · Me**.

---

## 3. Gacha

- Support **multiple gacha banners** (currently a single featured banner).
- Each banner gets its own **inner detail page** (banner art, its own pool + disclosed rates, pull ×1 / ×10).
- Gacha entry point moves off the bottom nav (see §2) — reach it from Home.

---

## 4. Feed

- **Photo posts** — allow attaching image(s) to a post.
  - Needs image **storage** (Supabase Storage is the natural fit) + upload flow + display.
- **Comments** — users can comment on posts (thread/list under each post, comment counts).
- **Own posts on profile** — the user's profile page (`Me`) shows a grid/list of **their own posts**.

---

## Cross-cutting impact
- **Storage:** photo posts introduce a blob store (Supabase Storage) — first non-relational data.
- **Persistence:** party-room seat/role/PIN state and comments push more toward moving app data into Supabase Postgres (Roadmap phase 1).
- **Moderation:** photos + comments enlarge the UGC surface — image moderation and comment reporting matter for app-store review.
