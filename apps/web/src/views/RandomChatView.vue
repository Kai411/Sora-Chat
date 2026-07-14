<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { socket } from "../lib/socket";
import type { MatchFound, PublicUser } from "../types";

type State = "searching" | "chatting" | "ended";

const state = ref<State>("searching");
const peer = ref<PublicUser | null>(null);
const sessionId = ref("");
const messages = ref<{ me: boolean; text: string }[]>([]);
const draft = ref("");
const listEl = ref<HTMLElement | null>(null);

function scrollDown() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }));
}

function onMatch(m: MatchFound) {
  if (m.mode !== "chat") return;
  sessionId.value = m.sessionId;
  peer.value = m.peer;
  messages.value = [];
  state.value = "chatting";
}

function onMessage(m: { sessionId: string; text: string }) {
  if (m.sessionId !== sessionId.value) return;
  messages.value.push({ me: false, text: m.text });
  scrollDown();
}

function onEnded(m: { sessionId: string }) {
  if (m.sessionId === sessionId.value) state.value = "ended";
}

function send() {
  const text = draft.value.trim();
  if (!text || state.value !== "chatting") return;
  socket.emit("session:message", { sessionId: sessionId.value, text });
  messages.value.push({ me: true, text });
  draft.value = "";
  scrollDown();
}

function next() {
  if (state.value === "chatting") socket.emit("session:leave", { sessionId: sessionId.value });
  peer.value = null;
  state.value = "searching";
  socket.emit("queue:join", { mode: "chat" });
}

onMounted(() => {
  socket.on("match:found", onMatch);
  socket.on("session:message", onMessage);
  socket.on("session:ended", onEnded);
  socket.emit("queue:join", { mode: "chat" });
});

onUnmounted(() => {
  socket.off("match:found", onMatch);
  socket.off("session:message", onMessage);
  socket.off("session:ended", onEnded);
  if (state.value === "chatting") socket.emit("session:leave", { sessionId: sessionId.value });
  socket.emit("queue:leave");
});
</script>

<template>
  <div class="flex flex-col">
    <header class="flex items-center gap-3 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <RouterLink to="/" class="text-white/50">←</RouterLink>
      <template v-if="peer">
        <span class="text-2xl">{{ peer.avatar }}</span>
        <div class="flex-1">
          <p class="text-sm font-semibold">{{ peer.nickname }}</p>
          <p class="text-[10px] text-emerald-400">connected</p>
        </div>
      </template>
      <p v-else class="flex-1 text-sm font-semibold">Random Chat</p>
      <button
        class="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-fuchsia-300"
        @click="next"
      >
        {{ state === "chatting" ? "Skip →" : "Retry" }}
      </button>
    </header>

    <div v-if="state === 'searching'" class="flex flex-1 flex-col items-center justify-center gap-4">
      <div class="relative grid size-24 place-items-center">
        <span class="anim-ring absolute inset-0 rounded-full bg-fuchsia-500/30"></span>
        <span class="grid size-20 place-items-center rounded-full bg-surface-2 text-4xl">💬</span>
      </div>
      <p class="text-sm text-white/50">Finding someone for you…</p>
      <p class="text-xs text-white/25">(open a second browser tab to match with yourself)</p>
    </div>

    <template v-else>
      <div ref="listEl" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <p v-if="state === 'ended'" class="py-2 text-center text-xs text-white/40">
          {{ peer?.nickname }} left the chat
        </p>
        <div
          v-for="(m, i) in messages"
          :key="i"
          class="flex"
          :class="m.me ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm"
            :class="m.me ? 'rounded-br-sm bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'rounded-bl-sm bg-surface-2'"
          >
            {{ m.text }}
          </div>
        </div>
      </div>

      <footer class="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input
          v-model="draft"
          :disabled="state !== 'chatting'"
          placeholder="Say something nice…"
          class="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50 disabled:opacity-40"
          @keydown.enter="send"
        />
        <button
          class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold disabled:opacity-40"
          :disabled="!draft.trim() || state !== 'chatting'"
          @click="send"
        >
          Send
        </button>
      </footer>
    </template>
  </div>
</template>
