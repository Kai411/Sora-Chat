<script setup lang="ts">
import { useRouter } from "vue-router";
import { useRoomStore } from "../stores/room";

const room = useRoomStore();
const router = useRouter();
</script>

<template>
  <div
    v-if="room.room"
    class="anim-pop-in mx-3 my-2 flex shrink-0 items-center gap-3 rounded-2xl border border-fuchsia-400/30 bg-surface-2/95 px-3.5 py-2.5 shadow-xl"
  >
    <button class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="router.push(`/rooms/${room.room.id}`)">
      <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-xl">{{ room.room.icon }}</span>
      <span class="min-w-0">
        <span class="block truncate text-sm font-semibold">{{ room.room.name }}</span>
        <span class="block text-[10px] text-white/40">{{ room.members.length }} inside · tap to return</span>
      </span>
    </button>
    <span
      v-if="room.unread"
      class="grid min-w-5 place-items-center rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[10px] font-bold"
    >
      {{ room.unread > 99 ? "99+" : room.unread }}
    </span>
    <button class="grid size-7 place-items-center rounded-full bg-surface text-xs text-white/50" @click="room.leave()">
      ✕
    </button>
  </div>
</template>
