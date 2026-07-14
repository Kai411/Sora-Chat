<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useRoomStore } from "../stores/room";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const room = useRoomStore();
const roomId = String(route.params.id);

const draft = ref("");
const listEl = ref<HTMLElement | null>(null);
const gone = ref(false);

function scrollDown() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }));
}

watch(() => room.messages.length, scrollDown);

function send() {
  const text = draft.value.trim();
  if (!text) return;
  room.send(text);
  draft.value = "";
}

function minimize() {
  // Keeps room membership; the dock takes over.
  router.back();
}

function leave() {
  room.leave();
  router.replace("/rooms");
}

onMounted(async () => {
  const ok = await room.join(roomId);
  if (!ok) {
    gone.value = true;
    return;
  }
  room.viewing = true;
  room.unread = 0;
  scrollDown();
});

onUnmounted(() => {
  // Deliberately NOT leaving the room — minimizing keeps membership.
  room.viewing = false;
});
</script>

<template>
  <div class="flex flex-col">
    <div v-if="gone" class="flex flex-1 flex-col items-center justify-center gap-3">
      <span class="text-5xl">🌬️</span>
      <p class="text-sm text-white/50">This room has closed</p>
      <RouterLink to="/rooms" class="text-xs text-fuchsia-300">← back to rooms</RouterLink>
    </div>

    <template v-else>
      <header class="border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div class="flex items-center gap-3">
          <button class="text-white/50" title="Minimize — you stay in the room" @click="minimize">⌄</button>
          <span class="text-2xl">{{ room.room?.icon }}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{{ room.room?.name ?? "…" }}</p>
            <p class="text-[10px] text-white/40">{{ room.members.length }} here now</p>
          </div>
          <button class="rounded-full bg-surface-2 px-3 py-1.5 text-xs text-red-300" @click="leave">Leave</button>
        </div>
        <div class="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">
          <span
            v-for="m in room.members"
            :key="m.id"
            class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs"
          >
            {{ m.avatar }} {{ m.nickname }}
          </span>
        </div>
      </header>

      <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <p v-if="!room.messages.length" class="py-6 text-center text-xs text-white/30">
          It's quiet in here… say hi 👋
        </p>
        <div
          v-for="m in room.messages"
          :key="m.id"
          class="flex gap-2.5"
          :class="m.userId === app.user?.id && 'flex-row-reverse'"
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-base">{{ m.avatar }}</span>
          <div class="max-w-[75%]" :class="m.userId === app.user?.id && 'text-right'">
            <p class="text-[10px] text-white/40">{{ m.author }}</p>
            <div
              class="mt-0.5 inline-block rounded-2xl px-3.5 py-2 text-left text-sm"
              :class="m.userId === app.user?.id ? 'rounded-tr-sm bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'rounded-tl-sm bg-surface-2'"
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
    </template>
  </div>
</template>
