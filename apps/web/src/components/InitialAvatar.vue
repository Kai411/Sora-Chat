<script setup lang="ts">
import { computed } from "vue";

// Placeholder profile picture: colored disc with the nickname's initial,
// until real profile photos exist.
const props = defineProps<{ name: string; userId: number; sizeClass?: string }>();

const PALETTE = [
  "bg-rose-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-lime-600",
];

const color = computed(() => PALETTE[Math.abs(props.userId) % PALETTE.length]);
const initial = computed(() => (props.name.trim()[0] ?? "?").toUpperCase());
</script>

<template>
  <span
    class="grid shrink-0 place-items-center rounded-full font-bold text-white"
    :class="[color, sizeClass ?? 'size-9 text-sm']"
  >
    {{ initial }}
  </span>
</template>
