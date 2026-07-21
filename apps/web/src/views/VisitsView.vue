<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import type { VisitEntry } from "../types";

const router = useRouter();
const app = useAppStore();
const tab = ref<"visitors" | "visited">("visitors");
const data = ref<{ visitors: VisitEntry[]; visited: VisitEntry[]; vip: boolean } | null>(null);
const menuFor = ref<number | null>(null); // "I visited" row whose hide-menu is open

const rows = computed(() => data.value?.[tab.value] ?? []);

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// Deterministic-ish blur bar width per row so masked names look varied but stable.
function maskWidth(i: number) {
  return 40 + ((i * 37) % 55);
}

async function toggleHide(v: VisitEntry) {
  const on = !v.hidden;
  const res = await socket.emitWithAck("visit:hide", { userId: v.user.id, on });
  if (res?.error) return;
  v.hidden = res.hidden;
  menuFor.value = null;
}

onMounted(async () => {
  data.value = await socket.emitWithAck("user:visits");
});
</script>

<template>
  <div class="flex h-full flex-col" @click="menuFor = null">
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

    <!-- non-VIP upsell on the "Visited me" tab -->
    <button
      v-if="tab === 'visitors' && data && !data.vip && rows.length"
      class="mx-5 mb-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-left"
      @click="router.push('/u/' + app.user?.id)"
    >
      <span class="text-lg">👑</span>
      <span class="flex-1 text-[11px] text-amber-200">Get VIP to see who visited your profile</span>
      <span class="text-amber-300">→</span>
    </button>

    <div class="flex-1 overflow-y-auto px-5 pb-8">
      <p v-if="!data || !rows.length" class="py-16 text-center text-xs text-white/30">
        {{ tab === "visitors" ? "No visitors yet — post something ✨" : "You haven't visited anyone yet" }}
      </p>

      <div
        v-for="(v, i) in rows"
        :key="tab + '-' + i"
        class="flex items-center gap-3 rounded-xl px-2 py-2.5"
      >
        <!-- masked (non-VIP viewing 'Visited me') -->
        <template v-if="v.masked">
          <Avatar
            avatar="/avatars/newbie.png"
            size-class="size-11 text-lg"
            class="pointer-events-none blur-[6px]"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block h-3 rounded-full bg-white/15 blur-[3px]"
              :style="{ width: maskWidth(i) + '%' }"
            ></span>
          </span>
        </template>

        <!-- real row -->
        <template v-else>
          <button class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="router.push(`/u/${v.user.id}`)">
            <Avatar :avatar="v.user.avatar" :name="v.user.nickname" :user-id="v.user.id" :frame="v.user.frame" size-class="size-11 text-lg" />
            <span class="min-w-0 flex-1 truncate text-sm">
              {{ v.user.nickname }}
              <span
                v-if="v.user.vip"
                class="ml-1 rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1 text-[9px] font-bold text-black"
                >VIP</span
              >
              <span v-if="v.count > 1" class="ml-1 text-[10px] text-white/35">· {{ v.count }} visits</span>
            </span>
          </button>
        </template>

        <span class="shrink-0 text-[10px] text-white/30">{{ ago(v.ts) }}</span>

        <!-- three-dots: VIP hide-my-visits on the "I visited" tab -->
        <div v-if="tab === 'visited' && data?.vip" class="relative shrink-0" @click.stop>
          <button class="grid size-7 place-items-center rounded-full text-white/40 active:bg-surface" @click="menuFor = menuFor === v.user.id ? null : v.user.id">
            <Icon name="more" cls="size-4" />
          </button>
          <div
            v-if="menuFor === v.user.id"
            class="absolute right-0 top-8 z-10 w-48 rounded-xl border border-line bg-surface-2 p-1 shadow-xl"
          >
            <button class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs active:bg-surface" @click="toggleHide(v)">
              <Icon name="eye-off" cls="size-4 text-white/50" />
              {{ v.hidden ? "Show my visits to them" : "Hide my visits from them" }}
            </button>
          </div>
        </div>
        <Icon v-else-if="tab === 'visited' && v.hidden" name="eye-off" cls="size-3.5 shrink-0 text-white/25" />
      </div>
    </div>
  </div>
</template>
