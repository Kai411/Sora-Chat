<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { socket } from "../lib/socket";
import { useCallStore } from "../stores/call";
import { useRoomStore } from "../stores/room";
import type { DmMessage, PublicUser } from "../types";

const route = useRoute();
const router = useRouter();
const call = useCallStore();
const room = useRoomStore();
const partnerId = Number(route.params.id);

const peer = ref<PublicUser | null>(null);
const messages = ref<DmMessage[]>([]);
const draft = ref("");
const error = ref("");
const listEl = ref<HTMLElement | null>(null);

function scrollDown() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }));
}

function onNew({ from, message }: { from: PublicUser; message: { id: number; text: string; ts: number } }) {
  if (from.id !== partnerId) return;
  messages.value.push({ ...message, mine: false });
  socket.emit("dm:read", { userId: partnerId });
  scrollDown();
}

async function send() {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = "";
  const msg = await socket.emitWithAck("dm:send", { userId: partnerId, text });
  if (msg) {
    messages.value.push(msg);
    scrollDown();
  }
}

async function startCall() {
  error.value = "";
  if (!peer.value) return;
  if (room.room) room.leave(); // calls can't run while docked in a room
  try {
    await call.invite(peer.value);
    router.push("/call");
  } catch (e: any) {
    error.value = e?.message ?? "Could not start the call";
    setTimeout(() => (error.value = ""), 2500);
  }
}

onMounted(async () => {
  socket.on("dm:new", onNew);
  const res = await socket.emitWithAck("dm:history", { userId: partnerId });
  if (res) {
    peer.value = res.peer;
    messages.value = res.messages;
    scrollDown();
  }
});
onUnmounted(() => socket.off("dm:new", onNew));
</script>

<template>
  <div class="flex flex-col">
    <header class="flex items-center gap-3 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <span class="grid size-9 place-items-center rounded-full bg-surface-2 text-xl">{{ peer?.avatar ?? "…" }}</span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">{{ peer?.nickname ?? "…" }}</p>
      </div>
      <button
        class="grid size-9 place-items-center rounded-full bg-emerald-500/15 text-lg text-emerald-300"
        title="Voice call"
        @click="startCall"
      >
        📞
      </button>
    </header>

    <p v-if="error" class="bg-red-500/15 py-1.5 text-center text-xs text-red-300">{{ error }}</p>

    <div ref="listEl" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      <p v-if="!messages.length" class="py-6 text-center text-xs text-white/30">
        Say hi to {{ peer?.nickname ?? "them" }} 👋
      </p>
      <div v-for="m in messages" :key="m.id" class="flex" :class="m.mine ? 'justify-end' : 'justify-start'">
        <div
          class="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm"
          :class="m.mine ? 'rounded-br-sm bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'rounded-bl-sm bg-surface-2'"
        >
          {{ m.text }}
        </div>
      </div>
    </div>

    <footer class="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <input
        v-model="draft"
        placeholder="Message…"
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
