<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import { RARITY_STYLE } from "../lib/rarity";
import type { GachaBanner, GachaItem, Rarity } from "../types";

const route = useRoute();
const app = useAppStore();
const bannerId = String(route.params.id);

const banner = ref<GachaBanner | null>(null);
const results = ref<GachaItem[] | null>(null);
const pulling = ref(false);
const toast = ref("");
const showPool = ref(false);

const RARITY_ORDER: Rarity[] = ["mythic", "legendary", "epic", "rare", "common"];

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

async function pull(count: 1 | 10) {
  if (pulling.value) return;
  pulling.value = true;
  try {
    const res = await socket.emitWithAck("gacha:pull", { bannerId, count });
    if (res?.error) return flash(res.error);
    app.coins = res.coins;
    app.inventory = res.inventory;
    results.value = res.results;
  } finally {
    pulling.value = false;
  }
}

onMounted(async () => {
  const banners: GachaBanner[] = await socket.emitWithAck("gacha:banners");
  banner.value = banners.find((b) => b.id === bannerId) ?? null;
});
</script>

<template>
  <div class="relative overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <RouterLink to="/gacha" class="text-white/50">←</RouterLink>
        <h1 class="text-xl font-bold">{{ banner?.name ?? "…" }}</h1>
      </div>
      <span class="rounded-full bg-surface px-3 py-1.5 text-sm font-semibold">🪙 {{ app.coins.toLocaleString() }}</span>
    </header>

    <template v-if="banner">
      <div class="relative mt-5 overflow-hidden rounded-3xl bg-gradient-to-br p-6" :class="banner.theme">
        <div class="anim-float absolute -top-2 right-4 text-6xl opacity-90">{{ banner.icon }}</div>
        <p class="text-xs font-medium tracking-widest text-white/70">FEATURED</p>
        <h2 class="mt-1 text-2xl font-extrabold leading-tight">
          {{ banner.mythic.icon }} {{ banner.mythic.name }}
        </h2>
        <p class="mt-2 max-w-[70%] text-xs text-white/80">{{ banner.tagline }}</p>
        <button class="mt-3 text-[10px] text-white/70 underline" @click="showPool = !showPool">
          {{ showPool ? "hide pool & rates" : "view pool & rates" }}
        </button>
      </div>

      <div v-if="showPool" class="mt-3 space-y-2 rounded-2xl border border-line bg-surface p-4">
        <div v-for="r in RARITY_ORDER" :key="r" class="text-xs">
          <span class="font-semibold" :class="RARITY_STYLE[r].text">
            {{ RARITY_STYLE[r].label }} · {{ (banner.pool[r].rate * 100).toFixed(1) }}%
          </span>
          <span class="ml-2 text-white/50">
            {{ banner.pool[r].items.map((i) => `${i.icon} ${i.name}`).join(" · ") }}
          </span>
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
    </template>

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
