<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import Avatar from "../components/Avatar.vue";
import type { AppNotification } from "../types";

const router = useRouter();
const app = useAppStore();

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function text(n: AppNotification) {
  const who = n.actor?.nickname ?? "Someone";
  if (n.type === "visit") return `${who} visited your profile`;
  if (n.type === "follow") return `${who} started following you`;
  if (n.type === "party") return `${who} opened ${n.roomName ? `“${n.roomName}”` : "a room"}`;
  return "";
}

function open(n: AppNotification) {
  if (n.type === "party" && n.roomId) router.push(`/rooms/${n.roomId}`);
  else if (n.actor) router.push(`/u/${n.actor.id}`);
}

onMounted(async () => {
  await app.loadNotifications();
  app.markNotificationsRead();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <p class="text-sm font-semibold">Notifications</p>
    </header>

    <div class="flex-1 overflow-y-auto px-4 pb-8">
      <p v-if="!app.notifications.length" class="py-16 text-center text-xs text-white/30">
        Nothing yet — you're all caught up ✨
      </p>
      <button
        v-for="n in app.notifications"
        :key="n.id"
        class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-surface"
        :class="!n.read && 'bg-fuchsia-500/5'"
        @click="open(n)"
      >
        <Avatar
          v-if="n.actor"
          :avatar="n.actor.avatar"
          :name="n.actor.nickname"
          :user-id="n.actor.id"
          :frame="n.actor.frame"
          size-class="size-11 text-lg"
        />
        <span
          v-else
          class="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-lg"
          >🔔</span
        >
        <span class="min-w-0 flex-1 text-sm leading-snug">{{ text(n) }}</span>
        <span class="shrink-0 text-[10px] text-white/30">{{ ago(n.ts) }}</span>
        <span v-if="n.type === 'party' && n.roomId" class="shrink-0 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-1 text-[10px] font-semibold">Join</span>
      </button>
    </div>
  </div>
</template>
