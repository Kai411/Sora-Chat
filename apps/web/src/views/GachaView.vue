<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import { RARITY_STYLE } from "../lib/rarity";
import type { GachaBanner, GachaItem, Rarity } from "../types";

const app = useAppStore();
const banners = ref<GachaBanner[]>([]);
const toast = ref("");

const inventorySummary = computed(() => {
  const map = new Map<string, GachaItem & { count: number }>();
  for (const item of app.inventory) {
    const cur = map.get(item.name);
    cur ? cur.count++ : map.set(item.name, { ...item, count: 1 });
  }
  const order: Rarity[] = ["mythic", "legendary", "epic", "rare", "common"];
  return [...map.values()].sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
});

async function claimDaily() {
  const res = await socket.emitWithAck("daily:claim");
  toast.value = res?.error ?? "Daily coins claimed! 🪙";
  if (!res?.error) app.coins = res.coins;
  setTimeout(() => (toast.value = ""), 2500);
}

onMounted(async () => {
  banners.value = await socket.emitWithAck("gacha:banners");
});
</script>

<template>
  <div class="relative overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <RouterLink to="/" class="text-white/50">←</RouterLink>
        <h1 class="text-xl font-bold">Gacha</h1>
      </div>
      <div class="flex items-center gap-2">
        <button class="rounded-full bg-surface px-3 py-1.5 text-xs text-white/60" @click="claimDaily">
          Daily 🎉
        </button>
        <span class="rounded-full bg-surface px-3 py-1.5 text-sm font-semibold">🪙 {{ app.coins.toLocaleString() }}</span>
      </div>
    </header>

    <!-- banners -->
    <div class="mt-5 space-y-4">
      <RouterLink
        v-for="b in banners"
        :key="b.id"
        :to="`/gacha/${b.id}`"
        class="relative block overflow-hidden rounded-3xl bg-gradient-to-br p-6 transition-transform active:scale-[0.98]"
        :class="b.theme"
      >
        <div class="anim-float absolute -top-2 right-4 text-6xl opacity-90">{{ b.icon }}</div>
        <p class="text-xs font-medium tracking-widest text-white/70">BANNER</p>
        <h2 class="mt-1 text-2xl font-extrabold leading-tight">{{ b.name }}</h2>
        <p class="mt-2 max-w-[70%] text-xs text-white/80">{{ b.tagline }}</p>
        <p class="mt-3 text-[10px] text-white/70">
          Featured: {{ b.mythic.icon }} {{ b.mythic.name }} · tap to open →
        </p>
      </RouterLink>
    </div>

    <!-- collection -->
    <section class="mt-7">
      <h2 class="text-sm font-semibold text-white/70">Collection ({{ app.inventory.length }})</h2>
      <p v-if="!inventorySummary.length" class="mt-3 text-xs text-white/30">
        Nothing yet — luck favors the bold ✨
      </p>
      <div class="mt-3 grid grid-cols-3 gap-2">
        <div
          v-for="item in inventorySummary"
          :key="item.name"
          class="rounded-xl border p-2.5 text-center"
          :class="RARITY_STYLE[item.rarity].card"
        >
          <div class="text-2xl">{{ item.icon }}</div>
          <p class="mt-1 truncate text-[10px] font-medium">{{ item.name }}</p>
          <p class="text-[9px]" :class="RARITY_STYLE[item.rarity].text">
            {{ RARITY_STYLE[item.rarity].label }}<span v-if="item.count > 1"> ×{{ item.count }}</span>
          </p>
        </div>
      </div>
    </section>

    <div
      v-if="toast"
      class="fixed top-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
