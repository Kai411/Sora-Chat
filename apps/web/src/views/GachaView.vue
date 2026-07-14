<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import type { GachaItem, Rarity } from "../types";

const app = useAppStore();
const results = ref<GachaItem[] | null>(null);
const pulling = ref(false);
const toast = ref("");
const rates = ref<{ rarity: Rarity; rate: number }[]>([]);
const showRates = ref(false);

const RARITY_STYLE: Record<Rarity, { label: string; card: string; text: string }> = {
  common: { label: "Common", card: "border-white/15 bg-surface-2", text: "text-white/60" },
  rare: { label: "Rare", card: "border-sky-400/50 bg-sky-500/10", text: "text-sky-300" },
  epic: { label: "Epic", card: "border-violet-400/60 bg-violet-500/15", text: "text-violet-300" },
  legendary: { label: "Legendary", card: "border-amber-400/70 bg-amber-500/15", text: "text-amber-300" },
  mythic: { label: "MYTHIC", card: "border-fuchsia-400 bg-fuchsia-500/20 anim-glow", text: "text-fuchsia-300" },
};

const inventorySummary = computed(() => {
  const map = new Map<string, GachaItem & { count: number }>();
  for (const item of app.inventory) {
    const cur = map.get(item.name);
    cur ? cur.count++ : map.set(item.name, { ...item, count: 1 });
  }
  const order: Rarity[] = ["mythic", "legendary", "epic", "rare", "common"];
  return [...map.values()].sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
});

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

async function pull(count: 1 | 10) {
  if (pulling.value) return;
  pulling.value = true;
  try {
    const res = await socket.emitWithAck("gacha:pull", { count });
    if (res?.error) return flash(res.error);
    app.coins = res.coins;
    app.inventory = res.inventory;
    results.value = res.results;
  } finally {
    pulling.value = false;
  }
}

async function claimDaily() {
  const res = await socket.emitWithAck("daily:claim");
  if (res?.error) return flash(res.error);
  app.coins = res.coins;
  flash("Daily coins claimed! 🪙");
}

onMounted(async () => {
  rates.value = await socket.emitWithAck("gacha:rates");
});
</script>

<template>
  <div class="relative overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
    <header class="flex items-center justify-between">
      <h1 class="text-xl font-bold">Gacha</h1>
      <div class="flex items-center gap-2">
        <button class="rounded-full bg-surface px-3 py-1.5 text-xs text-white/60" @click="claimDaily">
          Daily 🎉
        </button>
        <span class="rounded-full bg-surface px-3 py-1.5 text-sm font-semibold">🪙 {{ app.coins.toLocaleString() }}</span>
      </div>
    </header>

    <!-- banner -->
    <div class="relative mt-5 overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-500 p-6">
      <div class="anim-float absolute -top-2 right-4 text-6xl opacity-90">🪽</div>
      <p class="text-xs font-medium tracking-widest text-white/70">FEATURED BANNER</p>
      <h2 class="mt-1 text-2xl font-extrabold leading-tight">Genesis<br />Wings</h2>
      <p class="mt-2 max-w-[70%] text-xs text-white/80">
        Pull the Mythic entrance effect before the banner ends
      </p>
      <button class="mt-3 text-[10px] text-white/70 underline" @click="showRates = !showRates">
        {{ showRates ? "hide drop rates" : "view drop rates" }}
      </button>
      <div v-if="showRates" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-white/80">
        <span v-for="r in rates" :key="r.rarity" class="capitalize">{{ r.rarity }} {{ (r.rate * 100).toFixed(1) }}%</span>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-3">
      <button
        class="rounded-2xl border border-line bg-surface py-3.5 font-semibold transition-transform active:scale-95 disabled:opacity-40"
        :disabled="pulling"
        @click="pull(1)"
      >
        Pull ×1 <span class="block text-xs font-normal text-white/40">🪙 100</span>
      </button>
      <button
        class="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 py-3.5 font-semibold transition-transform active:scale-95 disabled:opacity-40"
        :disabled="pulling"
        @click="pull(10)"
      >
        Pull ×10 <span class="block text-xs font-normal text-white/80">🪙 900 · rare guaranteed</span>
      </button>
    </div>

    <!-- inventory -->
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

    <!-- pull results overlay -->
    <div
      v-if="results"
      class="fixed inset-0 z-20 mx-auto flex max-w-md flex-col items-center justify-center bg-black/85 px-6 backdrop-blur-sm"
      @click="results = null"
    >
      <p class="mb-5 text-sm font-semibold tracking-widest text-white/60">✨ RESULTS ✨</p>
      <div class="grid w-full gap-2.5" :class="results.length > 1 ? 'grid-cols-3' : 'max-w-40 grid-cols-1'">
        <div
          v-for="(item, i) in results"
          :key="i"
          class="anim-pop-in rounded-xl border p-3 text-center"
          :class="RARITY_STYLE[item.rarity].card"
          :style="{ animationDelay: `${i * 90}ms` }"
        >
          <div class="text-3xl">{{ item.icon }}</div>
          <p class="mt-1 truncate text-[10px] font-medium">{{ item.name }}</p>
          <p class="text-[9px] font-bold" :class="RARITY_STYLE[item.rarity].text">
            {{ RARITY_STYLE[item.rarity].label }}
          </p>
        </div>
      </div>
      <p class="mt-6 text-xs text-white/40">tap anywhere to close</p>
    </div>

    <div
      v-if="toast"
      class="fixed top-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
