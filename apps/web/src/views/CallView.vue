<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import { startCall, type CallHandle } from "../lib/webrtc";
import { useCallStore } from "../stores/call";

const router = useRouter();
const call = useCallStore();

const muted = ref(false);
const seconds = ref(0);
const connecting = ref(true);
const audioEl = ref<HTMLAudioElement | null>(null);

let handle: CallHandle | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function stop() {
  handle?.hangup();
  handle = null;
  if (timer) clearInterval(timer);
  timer = null;
}

async function begin() {
  connecting.value = true;
  try {
    handle = await startCall(
      call.sessionId,
      call.role === "caller",
      (stream) => {
        if (audioEl.value) {
          audioEl.value.srcObject = stream;
          audioEl.value.play().catch(() => {});
        }
      },
      (state) => {
        if (state === "connected" && connecting.value) {
          connecting.value = false;
          timer = setInterval(() => seconds.value++, 1000);
        }
        if (state === "failed") endCall();
      }
    );
  } catch {
    endCall();
  }
}

function endCall() {
  call.hangup();
  stop();
}

function onEnded({ sessionId }: { sessionId: string }) {
  if (sessionId === call.sessionId) {
    call.status = "ended";
    stop();
  }
}

function toggleMute() {
  if (handle) muted.value = handle.toggleMute();
}

function close() {
  call.reset();
  router.back();
}

watch(
  () => call.status,
  (s) => {
    if (s === "active" && !handle) begin();
  },
  { immediate: true }
);

const clock = () =>
  `${String(Math.floor(seconds.value / 60)).padStart(2, "0")}:${String(seconds.value % 60).padStart(2, "0")}`;

onMounted(() => {
  socket.on("session:ended", onEnded);
  if (call.status === "idle") router.replace("/");
});

onUnmounted(() => {
  socket.off("session:ended", onEnded);
  if (call.status === "ringing" || call.status === "active") call.hangup();
  stop();
  call.reset();
});
</script>

<template>
  <div class="flex flex-col bg-gradient-to-b from-bg via-[#131022] to-[#101d1d]">
    <audio ref="audioEl" autoplay class="hidden"></audio>

    <header class="flex items-center px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <p class="flex-1 text-center text-sm font-semibold">Voice Call</p>
    </header>

    <div class="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div class="relative grid size-32 place-items-center">
        <span
          v-if="call.status === 'ringing' || call.status === 'active'"
          class="anim-ring absolute inset-0 rounded-full bg-emerald-500/25"
        ></span>
        <span class="grid size-28 place-items-center rounded-full bg-surface-2 text-6xl">{{ call.peer?.avatar ?? "📞" }}</span>
      </div>
      <div>
        <p class="text-xl font-bold">{{ call.peer?.nickname ?? "…" }}</p>
        <p v-if="call.status === 'ringing'" class="mt-1 text-sm text-amber-300">Ringing…</p>
        <p v-else-if="call.status === 'active' && connecting" class="mt-1 text-sm text-amber-300">Connecting audio…</p>
        <p v-else-if="call.status === 'active'" class="mt-1 font-mono text-sm text-emerald-400">{{ clock() }}</p>
        <p v-else-if="call.status === 'declined'" class="mt-1 text-sm text-red-300">Declined the call</p>
        <p v-else-if="call.status === 'ended'" class="mt-1 text-sm text-white/50">Call ended</p>
      </div>
    </div>

    <footer class="flex items-center justify-center gap-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <template v-if="call.status === 'ringing' || call.status === 'active'">
        <button
          v-if="call.status === 'active'"
          class="grid size-14 place-items-center rounded-full text-2xl transition-colors"
          :class="muted ? 'bg-white text-black' : 'bg-surface-2'"
          @click="toggleMute"
        >
          {{ muted ? "🔇" : "🎙️" }}
        </button>
        <button
          class="grid size-16 place-items-center rounded-full bg-red-500 text-3xl transition-transform active:scale-90"
          @click="endCall"
        >
          📵
        </button>
      </template>
      <button v-else class="rounded-full bg-surface-2 px-8 py-3 text-sm font-semibold" @click="close">Close</button>
    </footer>
  </div>
</template>
