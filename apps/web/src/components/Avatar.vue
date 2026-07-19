<script setup lang="ts">
import { ref, watch } from "vue";
import { assetUrl } from "../lib/socket";
import InitialAvatar from "./InitialAvatar.vue";

// Renders a user's profile picture: preset image when `avatar` is a path
// (bought in the avatar shop), otherwise the signup emoji — or an initial
// disc where that style fits better (room seats/chat).
//
// The pfp is ALWAYS the same size, framed or not. A worn frame overlays it,
// scaled up by `frameFit` (default 1.6). The scale is a visual transform, so
// layout never shifts; tune `frameFit` per surface if needed.
const props = defineProps<{
  avatar: string;
  name?: string;
  userId?: number;
  sizeClass?: string; // e.g. "size-11 text-2xl"
  fallback?: "emoji" | "initial";
  frame?: string | null;
  /** frame overlay scale relative to the pfp box. */
  frameFit?: number;
}>();

const broken = ref(false);
const frameBroken = ref(false);
watch(
  () => props.avatar,
  () => (broken.value = false),
);
watch(
  () => props.frame,
  () => (frameBroken.value = false),
);

const isImage = () => !broken.value && props.avatar?.startsWith("/");
const framed = () => !!props.frame && !frameBroken.value;
const frameStyle = () => ({ transform: `scale(${props.frameFit ?? 1.6})` });
</script>

<template>
  <span class="relative inline-grid shrink-0 place-items-center">
    <img
      :src="assetUrl(avatar)"
      class="shrink-0 rounded-full object-cover"
      :class="sizeClass ?? 'size-9'"
      alt=""
      @error="broken = true"
    />
    <!-- <InitialAvatar
      v-else="fallback === 'initial'"
      :name="name ?? '?'"
      :user-id="userId ?? 0"
      :size-class="sizeClass"
    /> -->
    <img
      v-if="framed()"
      :src="assetUrl(frame!)"
      class="pointer-events-none absolute inset-0 size-full max-w-none"
      :style="frameStyle()"
      alt=""
      @error="frameBroken = true"
    />
  </span>
</template>
