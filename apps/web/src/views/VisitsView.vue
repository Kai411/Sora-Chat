<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import Avatar from "../components/Avatar.vue";
import type { PublicUser } from "../types";

const router = useRouter();
const tab = ref<"visitors" | "visited">("visitors");
const data = ref<{ visitors: { user: PublicUser; ts: number }[]; visited: { user: PublicUser; ts: number }[] } | null>(null);

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

onMounted(async () => {
  data.value = await socket.emitWithAck("user:visits");
});
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <p class="text-sm font-semibold">Profile visits</p>
    </header>

    <div class="px-5 pb-3">
      <div class="flex rounded-full bg-surface p-1 text-xs">
        <button
          v-for="t in ['visitors', 'visited'] as const"
          :key="t"
          class="flex-1 rounded-full py-1.5 text-white/50"
          :class="tab === t && 'bg-surface-2 !text-white'"
          @click="tab = t"
        >
          {{ t === "visitors" ? "Visited me" : "I visited" }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-5 pb-8">
      <p v-if="!data || !data[tab].length" class="py-16 text-center text-xs text-white/30">
        {{ tab === "visitors" ? "No visitors yet — post something ✨" : "You haven't visited anyone yet" }}
      </p>
      <button
        v-for="v in data?.[tab] ?? []"
        :key="v.user.id"
        class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-surface"
        @click="router.push(`/u/${v.user.id}`)"
      >
        <Avatar :avatar="v.user.avatar" :name="v.user.nickname" :user-id="v.user.id" size-class="size-11 text-lg" />
        <span class="min-w-0 flex-1 truncate text-sm">
          {{ v.user.nickname }}
          <span
            v-if="v.user.vip"
            class="ml-1 rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1 text-[9px] font-bold text-black"
            >VIP</span
          >
        </span>
        <span class="text-[10px] text-white/30">{{ ago(v.ts) }}</span>
      </button>
    </div>
  </div>
</template>
