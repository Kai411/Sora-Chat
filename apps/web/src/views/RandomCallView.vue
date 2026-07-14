<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { socket } from "../lib/socket";
import { startCall, type CallHandle } from "../lib/webrtc";
import type { MatchFound, PublicUser } from "../types";

type State = "searching" | "connecting" | "live" | "ended" | "error";

const state = ref<State>("searching");
const peer = ref<PublicUser | null>(null);
const sessionId = ref("");
const muted = ref(false);
const seconds = ref(0);
const error = ref("");
const audioEl = ref<HTMLAudioElement | null>(null);

let call: CallHandle | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function stopCall() {
  call?.hangup();
  call = null;
  if (timer) clearInterval(timer);
  timer = null;
}

async function onMatch(m: MatchFound) {
  if (m.mode !== "call") return;
  sessionId.value = m.sessionId;
  peer.value = m.peer;
  state.value = "connecting";
  muted.value = false;
  seconds.value = 0;
  try {
    call = await startCall(
      m.sessionId,
      m.role === "caller",
      (stream) => {
        if (audioEl.value) {
          audioEl.value.srcObject = stream;
          audioEl.value.play().catch(() => {});
        }
      },
      (connState) => {
        if (connState === "connected" && state.value === "connecting") {
          state.value = "live";
          timer = setInterval(() => seconds.value++, 1000);
        }
        if (connState === "failed") hangupToEnded();
      }
    );
  } catch (e: any) {
    error.value = e?.name === "NotAllowedError" ? "Microphone access was denied." : "Could not start the call.";
    state.value = "error";
    socket.emit("session:leave", { sessionId: m.sessionId });
  }
}

function onEnded(m: { sessionId: string }) {
  if (m.sessionId !== sessionId.value) return;
  hangupToEnded();
}

function hangupToEnded() {
  stopCall();
  state.value = "ended";
}

function hangup() {
  socket.emit("session:leave", { sessionId: sessionId.value });
  hangupToEnded();
}

function next() {
  if (state.value === "live" || state.value === "connecting") hangup();
  peer.value = null;
  error.value = "";
  state.value = "searching";
  socket.emit("queue:join", { mode: "call" });
}

function toggleMute() {
  if (call) muted.value = call.toggleMute();
}

const clock = () =>
  `${String(Math.floor(seconds.value / 60)).padStart(2, "0")}:${String(seconds.value % 60).padStart(2, "0")}`;

onMounted(() => {
  socket.on("match:found", onMatch);
  socket.on("session:ended", onEnded);
  socket.emit("queue:join", { mode: "call" });
});

onUnmounted(() => {
  socket.off("match:found", onMatch);
  socket.off("session:ended", onEnded);
  if (state.value === "live" || state.value === "connecting")
    socket.emit("session:leave", { sessionId: sessionId.value });
  socket.emit("queue:leave");
  stopCall();
});
</script>

<template>
  <div class="flex flex-col bg-gradient-to-b from-bg via-[#131022] to-[#1d1130]">
    <audio ref="audioEl" autoplay class="hidden"></audio>

    <header class="flex items-center px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <RouterLink to="/" class="text-white/50">←</RouterLink>
      <p class="flex-1 text-center text-sm font-semibold">Random Call</p>
      <span class="w-4"></span>
    </header>

    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <template v-if="state === 'searching'">
        <div class="relative grid size-28 place-items-center">
          <span class="anim-ring absolute inset-0 rounded-full bg-sky-500/30"></span>
          <span class="grid size-24 place-items-center rounded-full bg-surface-2 text-5xl">📞</span>
        </div>
        <p class="text-sm text-white/50">Calling into the void…</p>
        <p class="text-xs text-white/25">You'll be connected to a random stranger</p>
      </template>

      <template v-else-if="peer && (state === 'connecting' || state === 'live')">
        <div class="relative grid size-32 place-items-center">
          <span v-if="state === 'live'" class="anim-ring absolute inset-0 rounded-full bg-emerald-500/25"></span>
          <span class="grid size-28 place-items-center rounded-full bg-surface-2 text-6xl">{{ peer.avatar }}</span>
        </div>
        <div>
          <p class="text-xl font-bold">{{ peer.nickname }}</p>
          <p v-if="state === 'connecting'" class="mt-1 text-sm text-amber-300">Connecting audio…</p>
          <p v-else class="mt-1 font-mono text-sm text-emerald-400">{{ clock() }}</p>
        </div>
      </template>

      <template v-else-if="state === 'ended'">
        <span class="text-5xl">👋</span>
        <p class="text-sm text-white/60">Call ended</p>
      </template>

      <template v-else-if="state === 'error'">
        <span class="text-5xl">🎙️</span>
        <p class="text-sm text-red-300">{{ error }}</p>
      </template>
    </div>

    <footer class="flex items-center justify-center gap-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <button
        v-if="state === 'live' || state === 'connecting'"
        class="grid size-14 place-items-center rounded-full text-2xl transition-colors"
        :class="muted ? 'bg-white text-black' : 'bg-surface-2'"
        @click="toggleMute"
      >
        {{ muted ? "🔇" : "🎙️" }}
      </button>
      <button
        v-if="state === 'live' || state === 'connecting'"
        class="grid size-16 place-items-center rounded-full bg-red-500 text-3xl transition-transform active:scale-90"
        @click="hangup"
      >
        📵
      </button>
      <button
        v-if="state === 'ended' || state === 'error'"
        class="rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 px-8 py-3 font-semibold"
        @click="next"
      >
        Next call →
      </button>
    </footer>
  </div>
</template>
