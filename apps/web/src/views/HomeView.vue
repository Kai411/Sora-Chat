<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useRoomStore } from "../stores/room";
import Avatar from "../components/Avatar.vue";

interface Feature {
  to: string;
  icon: string;
  title: string;
  desc: string;
  grad: string;
  callFeature?: boolean;
}

const app = useAppStore();
const room = useRoomStore();
const router = useRouter();

const features: Feature[] = [
  { to: "/random-chat", icon: "💬", title: "Random Chat", desc: "Text a stranger", grad: "from-violet-500 to-fuchsia-500" },
  { to: "/random-call", icon: "📞", title: "Random Call", desc: "Voice roulette", grad: "from-sky-500 to-cyan-400", callFeature: true },
  { to: "/rooms", icon: "🎪", title: "Party Rooms", desc: "Join the crowd", grad: "from-emerald-500 to-lime-400" },
  { to: "/gacha", icon: "🎁", title: "Gacha", desc: "Try your luck", grad: "from-amber-500 to-orange-500" },
];

function openFeature(f: Feature) {
  if (f.callFeature && room.room) return; // random call unavailable in a party room
  router.push(f.to);
}
</script>

<template>
  <div class="overflow-y-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
    <header class="flex items-center justify-between">
      <button class="flex items-center gap-3" @click="app.user && router.push(`/u/${app.user.id}`)">
        <Avatar :avatar="app.user?.avatar ?? '🙂'" :name="app.user?.nickname" :user-id="app.user?.id" :frame="app.user?.frame" size-class="size-11 text-2xl" />
        <div class="text-left">
          <p class="text-xs text-white/40">Welcome back</p>
          <p class="font-semibold leading-tight">
            {{ app.user?.nickname ?? "…" }}
            <span
              v-if="app.vip"
              class="ml-1 rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1.5 py-px text-[10px] font-bold text-black"
              >VIP</span
            >
          </p>
        </div>
      </button>
      <div class="flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold">
        🪙 {{ app.coins.toLocaleString() }}
      </div>
    </header>

    <div class="mt-6 grid grid-cols-2 gap-3">
      <button
        v-for="f in features"
        :key="f.to"
        class="rounded-2xl bg-gradient-to-br p-4 text-left transition-transform active:scale-95"
        :class="[f.grad, f.callFeature && room.room && 'opacity-40']"
        @click="openFeature(f)"
      >
        <div class="text-3xl">{{ f.icon }}</div>
        <p class="mt-2 font-bold leading-tight">{{ f.title }}</p>
        <p class="text-xs text-white/80">{{ f.callFeature && room.room ? "In a room" : f.desc }}</p>
      </button>
    </div>

    <section class="mt-7">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-white/70">Online now</h2>
        <span class="flex items-center gap-1.5 text-xs text-white/40">
          <span class="size-2 rounded-full bg-emerald-400"></span>
          {{ app.others.length }}
        </span>
      </div>
      <div class="scrollbar-none -mx-5 mt-3 flex gap-4 overflow-x-auto px-5">
        <button
          v-for="u in app.others"
          :key="u.id"
          class="flex w-14 shrink-0 flex-col items-center gap-1"
          :title="`View ${u.nickname}`"
          @click="router.push(`/u/${u.id}`)"
        >
          <div class="relative">
            <Avatar :avatar="u.avatar" :name="u.nickname" :user-id="u.id" :frame="u.frame" size-class="size-13 text-2xl" />
            <span class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-bg bg-emerald-400"></span>
          </div>
          <p class="w-full truncate text-center text-[10px] text-white/50">{{ u.nickname }}</p>
        </button>
        <p v-if="!app.others.length" class="py-3 text-xs text-white/30">
          No one else is online yet — check back soon.
        </p>
      </div>
    </section>
  </div>
</template>
