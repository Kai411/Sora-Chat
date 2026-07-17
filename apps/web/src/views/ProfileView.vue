<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import PostCard from "../components/PostCard.vue";
import CommentsSheet from "../components/CommentsSheet.vue";
import type { Post } from "../types";

const app = useAppStore();
const router = useRouter();
const toast = ref("");
const myPosts = ref<Post[]>([]);
const commentsFor = ref<Post | null>(null);

onMounted(async () => {
  myPosts.value = await socket.emitWithAck("feed:user", { userId: app.user?.id });
});

const perks = [
  { icon: "🪙", text: "Double daily coins (600/day)" },
  { icon: "🏅", text: "Gold VIP badge everywhere" },
  { icon: "🎯", text: "Priority matchmaking (soon)" },
  { icon: "🎨", text: "Exclusive profile themes (soon)" },
];

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

async function becomeVip() {
  const res = await socket.emitWithAck("vip:activate");
  if (res?.error) return flash(res.error);
  app.vip = res.vip;
  app.coins = res.coins;
  flash("Welcome to VIP! 👑");
}

async function logout() {
  await app.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="relative overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
    <div class="flex flex-col items-center pt-4">
      <div
        class="grid size-24 place-items-center rounded-full bg-surface-2 text-5xl"
        :class="app.vip && 'ring-2 ring-amber-400'"
      >
        {{ app.user?.avatar ?? "🙂" }}
      </div>
      <h1 class="mt-3 text-xl font-bold">
        {{ app.user?.nickname ?? "…" }}
        <span
          v-if="app.vip"
          class="ml-1 rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1.5 py-0.5 align-middle text-[10px] font-bold text-black"
          >VIP</span
        >
      </h1>
      <div class="mt-3 flex gap-6 text-center text-sm">
        <div><p class="font-bold">🪙 {{ app.coins.toLocaleString() }}</p><p class="text-[10px] text-white/40">coins</p></div>
        <div><p class="font-bold">{{ app.inventory.length }}</p><p class="text-[10px] text-white/40">items</p></div>
        <div><p class="font-bold">{{ myPosts.length }}</p><p class="text-[10px] text-white/40">posts</p></div>
      </div>
    </div>

    <section class="mt-8 overflow-hidden rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 to-orange-500/10 p-5">
      <h2 class="flex items-center gap-2 font-bold text-amber-300">👑 Sora VIP</h2>
      <ul class="mt-3 space-y-2 text-sm text-white/80">
        <li v-for="p in perks" :key="p.text" class="flex items-center gap-2.5">
          <span>{{ p.icon }}</span>{{ p.text }}
        </li>
      </ul>
      <button
        v-if="!app.vip"
        class="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 py-3 font-bold text-black transition-transform active:scale-95"
        @click="becomeVip"
      >
        Unlock VIP · 🪙 800
      </button>
      <p v-else class="mt-4 text-center text-sm font-semibold text-amber-300">You're a VIP member ✨</p>
      <p class="mt-2 text-center text-[10px] text-white/30">
        Prototype: paid with coins. Real builds use StoreKit / Play Billing / Stripe.
      </p>
    </section>

    <section class="mt-8">
      <h2 class="text-sm font-semibold text-white/70">My posts</h2>
      <p v-if="!myPosts.length" class="mt-3 text-xs text-white/30">You haven't posted yet — share something on the Feed ✨</p>
      <div class="mt-3 space-y-3">
        <PostCard v-for="p in myPosts" :key="p.id" :post="p" @comments="commentsFor = $event" />
      </div>
    </section>

    <button class="mt-8 w-full rounded-xl border border-line bg-surface py-3 text-sm text-red-300" @click="logout">
      Log out
    </button>

    <CommentsSheet v-if="commentsFor" :post="commentsFor" @close="commentsFor = null" />

    <div
      v-if="toast"
      class="fixed top-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
