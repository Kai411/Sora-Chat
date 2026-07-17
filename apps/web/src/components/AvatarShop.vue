<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import type { AvatarItem } from "../types";

// mode "wear": pick from avatars you already own. mode "shop": browse & buy.
const props = defineProps<{ mode?: "wear" | "shop" }>();
const emit = defineEmits<{ close: [] }>();
const app = useAppStore();

const mode = ref<"wear" | "shop">(props.mode ?? "wear");
const items = ref<AvatarItem[]>([]);
const owned = ref<string[]>([]);
const current = ref("");
const error = ref("");
const busy = ref(false);

const ownedItems = computed(() => items.value.filter((i) => owned.value.includes(i.id)));

async function load() {
  const res = await socket.emitWithAck("avatar:catalog");
  if (!res) return;
  items.value = res.items;
  owned.value = res.owned;
  current.value = res.current;
}

async function pick(item: AvatarItem) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (owned.value.includes(item.id)) {
      const res = await socket.emitWithAck("avatar:set", { id: item.id });
      if (res?.error) return (error.value = res.error);
      current.value = res.avatar;
      if (app.user) app.user.avatar = res.avatar;
    } else {
      const res = await socket.emitWithAck("avatar:buy", { id: item.id });
      if (res?.error) return (error.value = res.error);
      app.coins = res.coins;
      owned.value = res.owned;
      current.value = res.avatar;
      if (app.user) app.user.avatar = res.avatar;
    }
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" @click.self="emit('close')">
    <div class="flex max-h-[80%] flex-col rounded-t-3xl border-t border-line bg-bg">
      <div class="flex items-center justify-between px-5 py-3">
        <p class="text-sm font-semibold">{{ mode === "wear" ? "My avatars" : "Avatar shop" }}</p>
        <div class="flex items-center gap-3">
          <span class="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold">🪙 {{ app.coins.toLocaleString() }}</span>
          <button
            v-if="mode === 'wear' && ownedItems.length"
            class="text-xs font-medium text-fuchsia-300"
            @click="mode = 'shop'"
          >
            Shop
          </button>
          <button v-else-if="mode === 'shop'" class="text-xs font-medium text-white/50" @click="mode = 'wear'">
            My avatars
          </button>
          <button class="text-white/40" @click="emit('close')">✕</button>
        </div>
      </div>

      <p v-if="error" class="px-5 text-xs text-red-300">{{ error }}</p>

      <!-- WEAR: owned only -->
      <template v-if="mode === 'wear'">
        <div
          v-if="!ownedItems.length"
          class="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-12 text-center"
        >
          <span class="text-4xl">🖼️</span>
          <p class="text-sm text-white/50">No avatar available</p>
          <button
            class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold"
            @click="mode = 'shop'"
          >
            View shop
          </button>
        </div>
        <div v-else class="grid flex-1 grid-cols-3 gap-3 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            v-for="item in ownedItems"
            :key="item.id"
            class="flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition-transform active:scale-95"
            :class="current === item.src ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-line bg-surface'"
            :disabled="busy"
            @click="pick(item)"
          >
            <img :src="item.src" class="size-16 rounded-full bg-surface-2 object-cover" alt="" />
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              :class="current === item.src ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-surface-2 text-white/60'"
            >
              {{ current === item.src ? "Wearing" : "Wear" }}
            </span>
          </button>
        </div>
      </template>

      <!-- SHOP: everything, buyable -->
      <template v-else>
        <p class="px-5 text-[10px] text-white/35">Preset avatars only — buy once with coins, wear anytime.</p>
        <div class="grid flex-1 grid-cols-3 gap-3 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            v-for="item in items"
            :key="item.id"
            class="flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition-transform active:scale-95"
            :class="current === item.src ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-line bg-surface'"
            :disabled="busy"
            @click="pick(item)"
          >
            <img :src="item.src" class="size-16 rounded-full bg-surface-2 object-cover" alt="" />
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              :class="
                current === item.src
                  ? 'bg-fuchsia-500/20 text-fuchsia-300'
                  : owned.includes(item.id)
                    ? 'bg-surface-2 text-white/60'
                    : 'bg-amber-400/15 text-amber-300'
              "
            >
              {{ current === item.src ? "Wearing" : owned.includes(item.id) ? "Owned" : `🪙 ${item.price}` }}
            </span>
          </button>
          <p v-if="!items.length" class="col-span-3 py-8 text-center text-xs text-white/30">Loading…</p>
        </div>
      </template>
    </div>
  </div>
</template>
