# Preset profile pictures

Drop the shop avatars here as **square** images named `a01` … `a12`.

- Formats accepted: **`.png`, `.jpg`, `.jpeg`, `.webp`** (mix freely — the server
  detects each file's extension at startup).
- Recommended size: 512×512.
- Pricing tiers (edit in `apps/server/src/index.ts` if you want): a01–a04 = 300
  coins, a05–a08 = 600, a09–a12 = 1000.

Examples: `a01.png`, `a02.webp`, `a03.jpg` … all valid.

After adding or changing files, **restart the server** so it re-scans the folder.
Slots without a file fall back to `a0N.png` and simply show a broken image until
you add art (users who own it still render fine via the initial/emoji fallback).
