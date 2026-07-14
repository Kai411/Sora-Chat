<script setup lang="ts">
import { onMounted, ref } from "vue";
import { socket } from "../lib/socket";
import type { RoomInfo } from "../types";

const rooms = ref<RoomInfo[]>([]);

onMounted(async () => {
  rooms.value = await socket.emitWithAck("rooms:list");
});
</script>

<template>
  <div class="overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
    <h1 class="text-xl font-bold">Chat Rooms</h1>
    <p class="mt-0.5 text-xs text-white/40">Group text now — group audio coming with LiveKit</p>

    <div class="mt-5 space-y-3">
      <RouterLink
        v-for="r in rooms"
        :key="r.id"
        :to="`/rooms/${r.id}`"
        class="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition-transform active:scale-[0.98]"
      >
        <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-2xl">{{ r.icon }}</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ r.name }}</p>
          <p class="truncate text-xs text-white/40">{{ r.topic }}</p>
        </div>
        <span class="flex items-center gap-1.5 text-xs text-white/40">
          <span class="size-2 rounded-full bg-emerald-400"></span>{{ r.members }}
        </span>
      </RouterLink>
    </div>
  </div>
</template>
