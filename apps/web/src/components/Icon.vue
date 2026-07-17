<script setup lang="ts">
// Minimal inline icon set (lucide-style paths) — functional UI glyphs only;
// decorative emoji (room icons, gacha items) stay emoji.
defineProps<{ name: keyof typeof PATHS; cls?: string }>();

const PATHS = {
  mic: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  "mic-off": [
    "M2 2l20 20",
    "M18.89 13.23A7.12 7.12 0 0 0 19 12v-2",
    "M5 10v2a7 7 0 0 0 12 4.9",
    "M15 9.34V5a3 3 0 0 0-5.68-1.33",
    "M9 9v3a3 3 0 0 0 5.12 2.12",
    "M12 19v3",
  ],
  plus: ["M12 5v14", "M5 12h14"],
  gift: [
    "M3 9h18v4H3z",
    "M12 9v12",
    "M19 13v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6",
    "M7.5 9a2.5 2.5 0 0 1 0-5C11 4 12 9 12 9s1-5 4.5-5a2.5 2.5 0 0 1 0 5",
  ],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  "step-down": ["M12 17V3", "M6 11l6 6 6-6", "M19 21H5"],
  seat: [
    "M6 19v2",
    "M18 19v2",
    "M6 12V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8",
    "M4 12h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z",
  ],
  x: ["M18 6 6 18", "M6 6l12 12"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 10 0v4"],
  unlock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 9.9-1"],
  minimize: ["M4 14h6v6", "M20 10h-6V4", "M14 10l7-7", "M3 21l7-7"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  heart: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"],
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
  "user-x": ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M17 8l5 5", "M22 8l-5 5"],
} as const;
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="cls ?? 'size-4'"
  >
    <path v-for="(d, i) in PATHS[name]" :key="i" :d="d" />
  </svg>
</template>
