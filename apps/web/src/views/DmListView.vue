<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { socket } from "../lib/socket";
import Avatar from "../components/Avatar.vue";
import type { Conversation } from "../types";

const conversations = ref<Conversation[]>([]);

async function load() {
  conversations.value = await socket.emitWithAck("dm:conversations");
}

function onNew() {
  load();
}

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

onMounted(() => {
  socket.on("dm:new", onNew);
  load();
});
onUnmounted(() => socket.off("dm:new", onNew));
</script>

<template>
  <div
    class="overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6"
  >
    <h1 class="text-xl font-bold">Chat</h1>

    <div
      v-if="!conversations.length"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <span class="text-5xl">💌</span>
      <p class="text-sm text-white/50">No conversations yet</p>
      <p class="text-xs text-white/30">
        Tap someone on the home screen to say hi
      </p>
    </div>

    <div class="mt-4 space-y-1">
      <RouterLink
        v-for="c in conversations"
        :key="c.user.id"
        :to="`/dms/${c.user.id}`"
        class="flex items-center gap-3 rounded-2xl p-3 transition-colors active:bg-surface"
      >
        <Avatar
          :avatar="c.user.avatar"
          :name="c.user.nickname"
          :user-id="c.user.id"
          :frame="c.user.frame"
          size-class="size-12 text-2xl"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">
            {{ c.user.nickname }}
            <span
              v-if="c.user.vip"
              class="ml-1 rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1 text-[9px] font-bold text-black"
              >VIP</span
            >
          </p>
          <p
            class="truncate text-xs"
            :class="c.unread ? 'font-semibold text-white' : 'text-white/40'"
          >
            {{ c.last.mine ? "You: " : "" }}{{ c.last.text }}
          </p>
        </div>
        <div class="flex flex-col items-end gap-1">
          <span class="text-[10px] text-white/30">{{ ago(c.last.ts) }}</span>
          <span
            v-if="c.unread"
            class="grid min-w-5 place-items-center rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[10px] font-bold"
          >
            {{ c.unread }}
          </span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
