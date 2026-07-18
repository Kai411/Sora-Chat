<script setup lang="ts">
import { ref, watch } from "vue";
import { assetUrl } from "../lib/socket";
import InitialAvatar from "./InitialAvatar.vue";

// Renders a user's profile picture: preset image when `avatar` is a path
// (bought in the avatar shop), otherwise the signup emoji — or an initial
// disc where that style fits better (room seats/chat). When a `frame` is
// given, it overlays around the picture (sized relative to the avatar, so it
// scales at every usage).
const props = defineProps<{
  avatar: string;
  name?: string;
  userId?: number;
  sizeClass?: string; // e.g. "size-11 text-2xl"
  fallback?: "emoji" | "initial";
  frame?: string | null;
}>();

const broken = ref(false);
const frameBroken = ref(false);
watch(
  () => props.avatar,
  () => (broken.value = false)
);
watch(
  () => props.frame,
  () => (frameBroken.value = false)
);

const isImage = () => !broken.value && props.avatar?.startsWith("/");
</script>

<template>
  <span class="relative inline-grid shrink-0 place-items-center">
    <img
      v-if="isImage()"
      :src="assetUrl(avatar)"
      class="shrink-0 rounded-full object-cover"
      :class="sizeClass ?? 'size-9'"
      alt=""
      @error="broken = true"
    />
    <InitialAvatar
      v-else-if="fallback === 'initial'"
      :name="name ?? '?'"
      :user-id="userId ?? 0"
      :size-class="sizeClass"
    />
    <span
      v-else
      class="grid shrink-0 place-items-center rounded-full bg-surface-2"
      :class="sizeClass ?? 'size-9 text-lg'"
    >
      {{ avatar || "🙂" }}
    </span>
    <img
      v-if="frame && !frameBroken"
      :src="assetUrl(frame)"
      class="pointer-events-none absolute -inset-[20%] size-[140%] max-w-none"
      alt=""
      @error="frameBroken = true"
    />
  </span>
</template>
