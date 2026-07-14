<script setup lang="ts">
import { useRouter } from "vue-router";
import { useCallStore } from "../stores/call";
import { useRoomStore } from "../stores/room";

const call = useCallStore();
const room = useRoomStore();
const router = useRouter();

async function accept() {
  // Product rule: taking a call leaves any docked room.
  if (room.room) room.leave();
  if (await call.accept()) router.push("/call");
}
</script>

<template>
  <div
    v-if="call.incoming"
    class="absolute inset-x-3 top-3 z-30 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-surface-2/95 p-3.5 shadow-xl backdrop-blur"
  >
    <div class="relative grid size-12 shrink-0 place-items-center rounded-full bg-surface text-2xl">
      <span class="anim-ring absolute inset-0 rounded-full bg-emerald-500/30"></span>
      {{ call.incoming.from.avatar }}
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">{{ call.incoming.from.nickname }}</p>
      <p class="text-[10px] text-emerald-300">Incoming call…</p>
    </div>
    <button class="grid size-11 place-items-center rounded-full bg-red-500/90 text-lg" @click="call.decline()">📵</button>
    <button class="grid size-11 place-items-center rounded-full bg-emerald-500 text-lg" @click="accept">📞</button>
  </div>
</template>
