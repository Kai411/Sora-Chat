<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import type { RoomCategory, RoomInfo } from "../types";

const CATEGORIES: { id: RoomCategory; label: string; icon: string }[] = [
  { id: "music", label: "Music Room", icon: "🎵" },
  { id: "private", label: "Private Room", icon: "🔒" },
  { id: "chat", label: "Chat Room", icon: "💬" },
];

const router = useRouter();
const rooms = ref<RoomInfo[]>([]);
const creating = ref(false);
const category = ref<RoomCategory>("chat");
const name = ref("");
const topic = ref("");
const locked = ref(false);
const pin = ref("");
const error = ref("");

const categoryLabel = (id: RoomCategory) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

async function load() {
  rooms.value = await socket.emitWithAck("rooms:list");
}

async function create() {
  error.value = "";
  if (locked.value && !/^\d{4}$/.test(pin.value))
    return (error.value = "PIN must be exactly 4 digits");
  const res = await socket.emitWithAck("rooms:create", {
    category: category.value,
    name: name.value,
    topic: topic.value,
    pin: locked.value ? pin.value : null,
  });
  if (res?.error) return (error.value = res.error);
  creating.value = false;
  name.value = topic.value = pin.value = "";
  locked.value = false;
  router.push(`/rooms/${res.room.id}`);
}

onMounted(load);
</script>

<template>
  <div class="relative flex flex-col">
    <div
      class="flex-1 overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6"
    >
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold">Party Rooms</h1>
          <p class="mt-0.5 text-xs text-white/40">
            Made by people here, alive while someone's inside
          </p>
        </div>
        <button
          class="rounded-full bg-surface px-3 py-1.5 text-xs text-white/60"
          @click="load"
        >
          ↻
        </button>
      </div>

      <div
        v-if="!rooms.length"
        class="flex flex-col items-center gap-3 py-16 text-center"
      >
        <span class="text-5xl">🎪</span>
        <p class="text-sm text-white/50">No rooms right now</p>
        <p class="text-xs text-white/30">
          Be the one who starts tonight's party
        </p>
      </div>

      <div class="mt-5 space-y-3">
        <RouterLink
          v-for="r in rooms"
          :key="r.id"
          :to="`/rooms/${r.id}`"
          class="block rounded-2xl border border-line bg-surface p-4 transition-transform active:scale-[0.98]"
        >
          <p class="flex items-center gap-1 truncate font-semibold">
            <Icon
              v-if="r.locked"
              name="lock"
              cls="size-3.5 shrink-0 text-white/50"
            />{{ r.name }}
          </p>
          <p class="mt-2 flex items-center gap-1.5 text-xs text-white/50">
            <span class="text-base leading-none scale-[0.7]">{{ r.icon }}</span
            >{{ categoryLabel(r.category) }}
          </p>
          <div class="mt-6 flex items-center justify-between">
            <div class="flex min-w-0 items-center gap-2">
              <Avatar
                :avatar="r.creator?.avatar ?? '🙂'"
                :name="r.creator?.nickname"
                :user-id="r.creator?.id ?? 0"
                :frame="r.creator?.frame"
                size-class="size-6 text-xs"
                fallback="initial"
              />
              <span class="min-w-0 truncate text-xs text-white/60">{{
                r.creator?.nickname
              }}</span>
            </div>
            <span
              class="flex shrink-0 items-center gap-1.5 text-xs text-white/40"
            >
              <span class="size-2 rounded-full bg-emerald-400"></span
              >{{ r.members }}
            </span>
          </div>
        </RouterLink>
      </div>
    </div>

    <button
      class="anim-glow absolute right-5 bottom-5 grid size-13 place-items-center rounded-full bg-gradient-to-r from-emerald-500 to-lime-400 text-2xl"
      @click="creating = true"
    >
      ＋
    </button>

    <div
      v-if="creating"
      class="absolute inset-0 z-10 flex flex-col justify-center overflow-y-auto bg-bg/95 p-6 backdrop-blur"
    >
      <h2 class="text-lg font-bold">Create a room</h2>
      <div class="mt-4 space-y-4">
        <div>
          <label class="mb-2 block text-xs font-medium text-white/50"
            >CATEGORY</label
          >
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="c in CATEGORIES"
              :key="c.id"
              class="rounded-xl bg-surface py-2.5 text-xs font-medium text-white/60"
              :class="
                category === c.id &&
                'ring-2 ring-emerald-400 bg-surface-2 !text-white'
              "
              @click="category = c.id"
            >
              <span class="block text-lg">{{ c.icon }}</span
              >{{ c.label }}
            </button>
          </div>
        </div>
        <div
          class="flex items-center gap-2 rounded-xl border border-line bg-surface px-3"
        >
          <span class="shrink-0 text-xs text-white/40"
            >{{ categoryLabel(category) }} ·</span
          >
          <input
            v-model="name"
            maxlength="30"
            placeholder="room name"
            class="w-full bg-transparent py-3 text-sm outline-none placeholder:text-white/25"
          />
        </div>
        <input
          v-model="topic"
          maxlength="60"
          placeholder="Topic (optional)"
          class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-emerald-400/50"
        />
        <div
          class="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
        >
          <div>
            <p class="text-sm">🔒 Lock with PIN</p>
            <p class="text-[10px] text-white/35">
              4 digits · will become a VIP perk later
            </p>
          </div>
          <div class="flex items-center gap-2">
            <input
              v-if="locked"
              v-model="pin"
              maxlength="4"
              inputmode="numeric"
              placeholder="0000"
              class="w-16 rounded-lg bg-surface-2 px-2 py-1.5 text-center font-mono text-sm outline-none"
            />
            <button
              class="h-6 w-11 rounded-full transition-colors"
              :class="locked ? 'bg-emerald-500' : 'bg-surface-2'"
              @click="locked = !locked"
            >
              <span
                class="block size-5 rounded-full bg-white transition-transform"
                :class="locked ? 'translate-x-5' : 'translate-x-0.5'"
              ></span>
            </button>
          </div>
        </div>
        <p v-if="error" class="text-xs text-red-300">{{ error }}</p>
        <div class="flex gap-3">
          <button
            class="flex-1 rounded-xl border border-line bg-surface py-3 text-sm"
            @click="creating = false"
          >
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
