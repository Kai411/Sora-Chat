<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { assetUrl, socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import type { ShopCategory, ShopType } from "../types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();

const TABS: { type: ShopType; label: string; icon: string }[] = [
  { type: "avatar", label: "Avatar", icon: "🙂" },
  { type: "frame", label: "Frame", icon: "🖼️" },
  { type: "background", label: "Background", icon: "🌆" },
  { type: "bubble", label: "Bubble", icon: "💬" },
  { type: "pet", label: "Pet", icon: "🐾" },
];

const categories = ref<ShopCategory[]>([]);
const active = ref<ShopType>((route.query.cat as ShopType) || "avatar");
const busy = ref(false);
const toast = ref("");

const current = computed(() => categories.value.find((c) => c.type === active.value));

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

async function load() {
  const res = await socket.emitWithAck("shop:catalog");
  if (!res) return;
  categories.value = res.categories;
  app.coins = res.coins;
}

function isEquipped(cat: ShopCategory, src: string) {
  return cat.equipped === src;
}

async function pick(cat: ShopCategory, src: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    if (isEquipped(cat, src)) {
      if (cat.type === "avatar") return; // avatar always equipped
      const res = await socket.emitWithAck("shop:unequip", { type: cat.type });
      if (res?.error) return flash(res.error);
      cat.equipped = res.equipped;
      syncSelf(cat.type, res.equipped);
    } else if (cat.owned.includes(src)) {
      const res = await socket.emitWithAck("shop:equip", { type: cat.type, src });
      if (res?.error) return flash(res.error);
      cat.equipped = res.equipped;
      syncSelf(cat.type, res.equipped);
    } else {
      const res = await socket.emitWithAck("shop:buy", { type: cat.type, src });
      if (res?.error) return flash(res.error);
      app.coins = res.coins;
      cat.owned = res.owned;
      cat.equipped = res.equipped;
      syncSelf(cat.type, res.equipped);
      flash("Purchased & equipped ✨");
    }
  } finally {
    busy.value = false;
  }
}

// keep the live session's own cosmetics in sync so the rest of the app reacts
function syncSelf(type: ShopType, src: string | null) {
  if (!app.user) return;
  if (type === "avatar" && src) app.user.avatar = src;
  if (type === "frame") app.user.frame = src;
  if (type === "pet") app.user.pet = src;
}

function priceLabel(cat: ShopCategory, src: string, price: number) {
  if (isEquipped(cat, src)) return "Wearing";
  if (cat.owned.includes(src)) return "Equip";
  return `🪙 ${price}`;
}

onMounted(load);
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <p class="flex-1 text-sm font-semibold">Shop</p>
      <span class="rounded-full bg-surface px-3 py-1.5 text-sm font-semibold">🪙 {{ app.coins.toLocaleString() }}</span>
    </header>

    <!-- category tabs -->
    <div class="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-3">
      <button
        v-for="t in TABS"
        :key="t.type"
        class="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-colors"
        :class="active === t.type ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white' : 'bg-surface text-white/50'"
        @click="active = t.type"
      >
        <span>{{ t.icon }}</span>{{ t.label }}
      </button>
    </div>

    <div v-if="current" class="flex-1 overflow-y-auto px-4 pb-8">
      <p
        v-if="!current.items.length"
        class="flex flex-col items-center gap-2 py-16 text-center text-xs text-white/30"
      >
        <span class="text-4xl">{{ TABS.find((t) => t.type === active)?.icon }}</span>
        No {{ active }} items yet — drop art in <code class="text-white/40">public/{{ active === 'avatar' ? 'avatars' : active === 'background' ? 'backgrounds' : active + 's' }}/</code>
      </p>

      <div v-else class="grid grid-cols-3 gap-3">
        <button
          v-for="item in current.items"
          :key="item.src"
          class="flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition-transform active:scale-95"
          :class="isEquipped(current, item.src) ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-line bg-surface'"
          :disabled="busy"
          @click="pick(current, item.src)"
        >
          <div class="relative grid size-16 place-items-center">
            <img
              v-if="active !== 'bubble'"
              :src="assetUrl(item.src)"
              class="size-16 rounded-full bg-surface-2 object-cover"
              :class="active === 'background' && '!rounded-xl'"
              alt=""
            />
            <div v-else class="grid size-16 place-items-center">
              <span class="rounded-2xl rounded-bl-sm bg-surface-2 px-2 py-1 text-[9px] text-white/70" :style="{ backgroundImage: `url(${assetUrl(item.src)})`, backgroundSize: 'cover' }">Aa</span>
            </div>
          </div>
          <span class="w-full truncate text-center text-[10px] text-white/70">{{ item.name }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            :class="
              isEquipped(current, item.src)
                ? 'bg-fuchsia-500/20 text-fuchsia-300'
                : current.owned.includes(item.src)
                  ? 'bg-surface-2 text-white/60'
                  : 'bg-amber-400/15 text-amber-300'
            "
          >
            {{ priceLabel(current, item.src, item.price) }}
          </span>
        </button>
      </div>

      <p v-if="active !== 'avatar' && current.items.length" class="mt-4 text-center text-[10px] text-white/25">
        Tap an owned item again to remove it.
      </p>
    </div>

    <div v-if="toast" class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg">
      {{ toast }}
    </div>
  </div>
</template>
