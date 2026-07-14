<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import type { PublicUser, RoomInfo, RoomMsg } from "../types";

const route = useRoute();
const app = useAppStore();
const roomId = String(route.params.id);

const room = ref<RoomInfo | null>(null);
const messages = ref<RoomMsg[]>([]);
const members = ref<PublicUser[]>([]);
const draft = ref("");
const listEl = ref<HTMLElement | null>(null);

function scrollDown() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }));
}

function onMessage(m: { roomId: string; message: RoomMsg }) {
  if (m.roomId !== roomId) return;
  messages.value.push(m.message);
  scrollDown();
}

function onMembers(m: { roomId: string; members: PublicUser[] }) {
  if (m.roomId === roomId) members.value = m.members;
}

function send() {
  const text = draft.value.trim();
  if (!text) return;
  socket.emit("room:message", { roomId, text });
  draft.value = "";
}

onMounted(async () => {
  socket.on("room:message", onMessage);
  socket.on("room:members", onMembers);
  const res = await socket.emitWithAck("room:join", { roomId });
  if (res) {
    room.value = res.room;
    messages.value = res.messages;
    members.value = res.members;
    scrollDown();
  }
});

onUnmounted(() => {
  socket.off("room:message", onMessage);
  socket.off("room:members", onMembers);
  socket.emit("room:leave", { roomId });
});
</script>

<template>
  <div class="flex flex-col">
    <header class="border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div class="flex items-center gap-3">
        <RouterLink to="/rooms" class="text-white/50">←</RouterLink>
        <span class="text-2xl">{{ room?.icon }}</span>
        <div class="flex-1">
          <p class="text-sm font-semibold">{{ room?.name ?? "…" }}</p>
          <p class="text-[10px] text-white/40">{{ members.length }} here now</p>
        </div>
      </div>
      <div class="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">
        <span
          v-for="m in members"
          :key="m.nickname"
          class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs"
          :title="m.nickname"
        >
          {{ m.avatar }} {{ m.nickname }}
        </span>
      </div>
    </header>

    <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      <p v-if="!messages.length" class="py-6 text-center text-xs text-white/30">
        It's quiet in here… say hi 👋
      </p>
      <div v-for="m in messages" :key="m.id" class="flex gap-2.5" :class="m.author === app.user?.nickname && 'flex-row-reverse'">
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-base">{{ m.avatar }}</span>
        <div class="max-w-[75%]" :class="m.author === app.user?.nickname && 'text-right'">
          <p class="text-[10px] text-white/40">{{ m.author }}</p>
          <div
            class="mt-0.5 inline-block rounded-2xl px-3.5 py-2 text-left text-sm"
            :class="m.author === app.user?.nickname ? 'rounded-tr-sm bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'rounded-tl-sm bg-surface-2'"
          >
            {{ m.text }}
          </div>
        </div>
      </div>
    </div>

    <footer class="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <input
        v-model="draft"
        placeholder="Message the room…"
        class="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
        @keydown.enter="send"
      />
      <button
        class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold disabled:opacity-40"
        :disabled="!draft.trim()"
        @click="send"
      >
        Send
      </button>
    </footer>
  </div>
</template>
