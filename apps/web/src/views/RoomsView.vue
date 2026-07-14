<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import type { RoomInfo } from "../types";

const ICONS = ["🎪", "🛋️", "🎵", "🎮", "🌙", "☕", "📚", "🌈"];

const router = useRouter();
const rooms = ref<RoomInfo[]>([]);
const creating = ref(false);
const name = ref("");
const topic = ref("");
const icon = ref(ICONS[0]);
const error = ref("");

async function load() {
  rooms.value = await socket.emitWithAck("rooms:list");
}

async function create() {
  error.value = "";
  const res = await socket.emitWithAck("rooms:create", {
    name: name.value,
    icon: icon.value,
    topic: topic.value,
  });
  if (res?.error) return (error.value = res.error);
  creating.value = false;
  name.value = topic.value = "";
  router.push(`/rooms/${res.room.id}`);
}

onMounted(load);
</script>

<template>
  <div class="relative flex flex-col">
    <div class="flex-1 overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold">Chat Rooms</h1>
          <p class="mt-0.5 text-xs text-white/40">Made by people here, alive while someone's inside</p>
        </div>
        <button class="rounded-full bg-surface px-3 py-1.5 text-xs text-white/60" @click="load">↻</button>
      </div>

      <div v-if="!rooms.length" class="flex flex-col items-center gap-3 py-16 text-center">
        <span class="text-5xl">🎪</span>
        <p class="text-sm text-white/50">No rooms right now</p>
        <p class="text-xs text-white/30">Be the one who starts tonight's conversation</p>
      </div>

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
            <p class="truncate text-xs text-white/40">
              {{ r.topic || `by ${r.creator?.nickname}` }}
            </p>
          </div>
          <span class="flex items-center gap-1.5 text-xs text-white/40">
            <span class="size-2 rounded-full bg-emerald-400"></span>{{ r.members }}
          </span>
        </RouterLink>
      </div>
    </div>

    <button
      class="anim-glow absolute right-5 bottom-5 grid size-13 place-items-center rounded-full bg-gradient-to-r from-emerald-500 to-lime-400 text-2xl"
      @click="creating = true"
    >
      ＋
    </button>

    <div v-if="creating" class="absolute inset-0 z-10 flex flex-col justify-center bg-bg/95 p-6 backdrop-blur">
      <h2 class="text-lg font-bold">Create a room</h2>
      <div class="mt-4 space-y-4">
        <div class="grid grid-cols-8 gap-1.5">
          <button
            v-for="i in ICONS"
            :key="i"
            class="rounded-lg bg-surface py-1.5 text-xl transition-transform active:scale-90"
            :class="icon === i && 'ring-2 ring-emerald-400 bg-surface-2'"
            @click="icon = i"
          >
            {{ i }}
          </button>
        </div>
        <input
          v-model="name"
          maxlength="30"
          placeholder="Room name"
          class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-emerald-400/50"
        />
        <input
          v-model="topic"
          maxlength="60"
          placeholder="Topic (optional)"
          class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-emerald-400/50"
          @keydown.enter="create"
        />
        <p v-if="error" class="text-xs text-red-300">{{ error }}</p>
        <div class="flex gap-3">
          <button class="flex-1 rounded-xl border border-line bg-surface py-3 text-sm" @click="creating = false">
            Cancel
          </button>
          <button
            class="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-lime-400 py-3 text-sm font-semibold text-black disabled:opacity-40"
            :disabled="!name.trim()"
            @click="create"
          >
            Create & join
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
