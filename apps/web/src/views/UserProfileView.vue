<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { assetUrl, socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import { pickImage } from "../lib/image";
import Avatar from "../components/Avatar.vue";
import PostCard from "../components/PostCard.vue";
import CommentsSheet from "../components/CommentsSheet.vue";
import Icon from "../components/Icon.vue";
import type { Post, Profile, PublicUser } from "../types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();

const profile = ref<Profile | null>(null);
const posts = ref<Post[]>([]);
const commentsFor = ref<Post | null>(null);
const showVip = ref(false);
const toast = ref("");
const followSheet = ref<"followers" | "following" | null>(null);
const followLists = ref<{ followers: PublicUser[]; following: PublicUser[] }>({
  followers: [],
  following: [],
});
const visits = ref<{
  visitors: { user: PublicUser; ts: number }[];
  visited: { user: PublicUser; ts: number }[];
} | null>(null);
const missing = ref(false);

// self cosmetics stay reactive to the live session
const selfFrame = computed(() =>
  isSelf.value ? app.user?.frame : profile.value?.user.frame,
);
// banner (custom upload) takes priority over the preset background cosmetic
// Banner is the custom uploaded photo only (purchased backgrounds are room-only).
const bannerUrl = computed(() =>
  profile.value?.banner ? assetUrl(profile.value.banner) : null,
);

// Banner spans from the top down to 1/3 up from the avatar's bottom, measured
// live so it lands right regardless of safe-area / header height.
const rootEl = ref<HTMLElement | null>(null);
const avatarBtn = ref<HTMLElement | null>(null);
const bannerH = ref(300);
function measureBanner() {
  if (!rootEl.value || !avatarBtn.value) return;
  const r = rootEl.value.getBoundingClientRect();
  const a = avatarBtn.value.getBoundingClientRect();
  bannerH.value = Math.round(a.top - r.top + a.height * (2 / 3));
}

async function changeBanner() {
  const dataUrl = await pickImage();
  if (!dataUrl) return;
  const res = await socket.emitWithAck("user:setBanner", { image: dataUrl });
  if (res?.error) return flash(res.error);
  if (profile.value) profile.value.banner = res.banner;
}

const userId = computed(() => Number(route.params.id));
const isSelf = computed(() => userId.value === app.user?.id);

const VIP_PERKS = [
  { icon: "🪙", text: "Double daily coins (600/day)" },
  { icon: "🏅", text: "Gold VIP badge everywhere" },
  { icon: "🎯", text: "Priority matchmaking (soon)" },
  { icon: "🔒", text: "Lock party rooms with a PIN" },
];

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

async function load() {
  missing.value = false;
  profile.value = null;
  const res = await socket.emitWithAck("user:profile", {
    userId: userId.value,
  });
  if (!res) {
    missing.value = true;
    return;
  }
  profile.value = res;
  posts.value = await socket.emitWithAck("feed:user", { userId: userId.value });
  if (isSelf.value) visits.value = await socket.emitWithAck("user:visits");
}

async function toggleFollow() {
  if (!profile.value) return;
  const res = await socket.emitWithAck("user:follow", { userId: userId.value });
  if (!res) return;
  profile.value.isFollowing = res.following;
  profile.value.followers += res.following ? 1 : -1;
}

async function openFollows(tab: "followers" | "following") {
  const res = await socket.emitWithAck("user:follows", {
    userId: userId.value,
  });
  if (res) followLists.value = res;
  followSheet.value = tab;
}

function goUser(u: PublicUser) {
  followSheet.value = null;
  if (u.id !== userId.value) router.push(`/u/${u.id}`);
}

async function claimDaily() {
  const res = await socket.emitWithAck("daily:claim");
  if (res?.error) return flash(res.error);
  app.coins = res.coins;
  flash("Daily coins claimed! 🪙");
}

async function activateVip() {
  const res = await socket.emitWithAck("vip:activate");
  if (res?.error) return flash(res.error);
  app.vip = res.vip;
  app.coins = res.coins;
  if (profile.value) profile.value.user.vip = true;
  showVip.value = false;
  flash("Welcome to VIP! 👑");
}

watch(
  () => route.params.id,
  async () => {
    await load();
    await nextTick();
    measureBanner();
  },
);
onMounted(async () => {
  await load();
  await nextTick();
  measureBanner();
  window.addEventListener("resize", measureBanner);
});
onBeforeUnmount(() => window.removeEventListener("resize", measureBanner));
</script>

<template>
  <div ref="rootEl" class="relative isolate flex h-full flex-col">
    <!-- banner: spans from the very top down to ~2/3 of the avatar -->
    <div
      v-if="bannerUrl"
      class="pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden"
      :style="{ height: bannerH + 'px' }"
    >
      <img :src="bannerUrl" class="size-full object-cover opacity-70" alt="" />
      <div
        class="absolute inset-0 bg-gradient-to-b from-transparent to-bg"
      ></div>
    </div>

    <!-- top bar -->
    <header
      class="flex items-center px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <button v-if="!isSelf" class="text-white/50" @click="router.back()">
        ←
      </button>
      <button
        v-else
        class="grid size-8 place-items-center rounded-full bg-black/40 text-white/70 backdrop-blur-sm"
        title="Set banner photo"
        @click="changeBanner"
      >
        <Icon name="image" cls="size-4" />
      </button>
      <div class="flex-1"></div>
      <div v-if="isSelf" class="flex items-center gap-2">
        <button
          v-if="!profile?.user.vip"
          class="rounded-full border border-amber-400/40 px-2.5 py-1 text-[11px] font-semibold text-amber-300"
          @click="showVip = true"
        >
          ✨ Get VIP
        </button>
        <button
          class="grid size-8 place-items-center rounded-full bg-surface-2 text-white/60"
          title="Settings"
          @click="router.push('/settings')"
        >
          <Icon name="gear" cls="size-4" />
        </button>
      </div>
    </header>

    <div
      v-if="missing"
      class="flex flex-1 items-center justify-center text-sm text-white/40"
    >
      User not found
    </div>

    <div v-else-if="profile" class="relative flex-1 overflow-y-auto px-5 pb-8">
      <div class="flex flex-col items-center pt-2 text-center">
        <button
          ref="avatarBtn"
          class="relative"
          :disabled="!isSelf"
          @click="isSelf && router.push('/shop?cat=avatar')"
        >
          <Avatar
            :avatar="
              isSelf
                ? (app.user?.avatar ?? profile.user.avatar)
                : profile.user.avatar
            "
            :name="isSelf ? app.user?.nickname : profile.user.nickname"
            :user-id="profile.user.id"
            :frame="selfFrame"
            size-class="size-24 text-5xl"
          />
        </button>
        <button
          v-if="isSelf"
          class="mt-2 rounded-full bg-surface px-3 py-1 text-[11px] text-fuchsia-300"
          @click="router.push('/shop?cat=avatar')"
        >
          Change avatar
        </button>
        <h1 class="mt-2 flex items-center gap-2 text-xl font-bold">
          {{ profile.user.nickname }}
          <button
            v-if="profile.user.vip"
            class="rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1.5 py-0.5 text-[10px] font-bold text-black"
            @click="showVip = true"
          >
            VIP
          </button>
        </h1>
        <p
          v-if="profile.followsYou && !isSelf"
          class="mt-1 text-[11px] text-white/40"
        >
          Follows you
        </p>

        <div class="mt-4 flex gap-8 text-center">
          <button @click="openFollows('followers')">
            <p class="font-bold">{{ profile.followers }}</p>
            <p class="text-[10px] text-white/40">followers</p>
          </button>
          <button @click="openFollows('following')">
            <p class="font-bold">{{ profile.following }}</p>
            <p class="text-[10px] text-white/40">following</p>
          </button>
          <button v-if="isSelf" @click="router.push('/visits')">
            <p class="font-bold">{{ visits?.visitors.length ?? 0 }}</p>
            <p class="text-[10px] text-white/40">visitors</p>
          </button>
          <div v-else>
            <p class="font-bold">{{ profile.posts }}</p>
            <p class="text-[10px] text-white/40">posts</p>
          </div>
        </div>

        <div v-if="!isSelf" class="mt-5 flex w-full gap-2.5">
          <button
            class="flex-1 rounded-xl py-3 text-sm font-semibold transition-transform active:scale-95"
            :class="
              profile.isFollowing
                ? 'bg-surface-2 text-white/60'
                : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
            "
            @click="toggleFollow"
          >
            {{ profile.isFollowing ? "Following" : "+ Follow" }}
          </button>
          <button
            class="flex-1 rounded-xl border border-line py-3 text-sm font-medium text-fuchsia-300"
            @click="router.push(`/dms/${profile.user.id}`)"
          >
            Message
          </button>
        </div>

        <div v-else class="mt-5 flex w-full items-center gap-2">
          <span
            class="flex items-center gap-1 rounded-xl bg-surface px-3 py-2.5 text-sm font-semibold"
            >🪙 {{ app.coins.toLocaleString() }}</span
          >
          <button
            class="flex-1 rounded-xl bg-surface py-2.5 text-sm font-medium"
            @click="claimDaily"
          >
            Daily 🎉
          </button>
          <button
            class="flex-1 rounded-xl bg-surface py-2.5 text-sm font-medium"
            @click="router.push('/shop')"
          >
            Shop
          </button>
        </div>
      </div>

      <!-- posts -->
      <section class="mt-7">
        <h2 class="text-sm font-semibold text-white/70">
          {{ profile.posts }} Posts
        </h2>
        <p v-if="!posts.length" class="mt-3 text-xs text-white/30">
          Nothing posted yet
        </p>
        <div class="mt-3 space-y-3">
          <PostCard
            v-for="p in posts"
            :key="p.id"
            :post="p"
            @comments="commentsFor = $event"
          />
        </div>
      </section>
    </div>

    <!-- followers / following sheet -->
    <div
      v-if="followSheet"
      class="absolute inset-0 z-20 flex flex-col justify-end bg-black/60"
      @click.self="followSheet = null"
    >
      <div
        class="flex max-h-[70%] flex-col rounded-t-3xl border-t border-line bg-bg"
      >
        <div class="flex items-center justify-between px-5 py-3">
          <p class="text-sm font-semibold capitalize">{{ followSheet }}</p>
          <button class="text-white/40" @click="followSheet = null">✕</button>
        </div>
        <div
          class="flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <p
            v-if="!followLists[followSheet].length"
            class="py-6 text-center text-xs text-white/30"
          >
            Nobody here yet
          </p>
          <button
            v-for="u in followLists[followSheet]"
            :key="u.id"
            class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-surface"
            @click="goUser(u)"
          >
            <Avatar
              :avatar="u.avatar"
              :name="u.nickname"
              :user-id="u.id"
              :frame="u.frame"
              size-class="size-10 text-xl"
            />
            <span class="min-w-0 flex-1 truncate text-sm">{{
              u.nickname
            }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- VIP details sheet -->
    <div
      v-if="showVip"
      class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60"
      @click.self="showVip = false"
    >
      <div
        class="rounded-t-3xl border-t border-amber-400/30 bg-gradient-to-b from-amber-500/10 to-bg p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15"></div>
        <h2 class="flex items-center gap-2 text-lg font-bold text-amber-300">
          👑 Sora VIP
        </h2>
        <ul class="mt-3 space-y-2 text-sm text-white/80">
          <li
            v-for="perk in VIP_PERKS"
            :key="perk.text"
            class="flex items-center gap-2.5"
          >
            <span>{{ perk.icon }}</span
            >{{ perk.text }}
          </li>
        </ul>
        <button
          v-if="isSelf && !profile?.user.vip"
          class="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 py-3 font-bold text-black transition-transform active:scale-95"
          @click="activateVip"
        >
          Unlock VIP · 🪙 800
        </button>
        <p
          v-else-if="profile?.user.vip"
          class="mt-4 text-center text-sm font-semibold text-amber-300"
        >
          {{
            isSelf
              ? "You're a VIP member ✨"
              : `${profile?.user.nickname} is a VIP member ✨`
          }}
        </p>
        <p class="mt-2 text-center text-[10px] text-white/30">
          Prototype: paid with coins. Real builds use StoreKit / Play Billing /
          Stripe.
        </p>
      </div>
    </div>

    <CommentsSheet
      v-if="commentsFor"
      :post="commentsFor"
      @close="commentsFor = null"
    />

    <div
      v-if="toast"
      class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
