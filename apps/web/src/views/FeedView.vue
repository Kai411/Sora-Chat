<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import type { Post } from "../types";

const app = useAppStore();
const tab = ref<"public" | "following">("public");
const feed = ref<Post[]>([]);
const draft = ref("");
const composing = ref(false);

async function load() {
  feed.value = await socket.emitWithAck("feed:list", { tab: tab.value });
}

function onNew({ post }: { post: Post }) {
  if (tab.value === "public" && !feed.value.some((p) => p.id === post.id)) {
    feed.value.unshift({ ...post, mine: post.author === app.user?.nickname });
  }
}

async function publish() {
  const text = draft.value.trim();
  if (!text) return;
  const post = await socket.emitWithAck("feed:post", { text });
  if (post && !feed.value.some((p) => p.id === post.id)) feed.value.unshift(post);
  draft.value = "";
  composing.value = false;
}

async function like(post: Post) {
  const res = await socket.emitWithAck("feed:like", { id: post.id });
  if (res) Object.assign(post, res);
}

async function follow(post: Post) {
  const res = await socket.emitWithAck("user:follow", { nickname: post.author });
  if (!res) return;
  for (const p of feed.value) if (p.author === res.nickname) p.following = res.following;
}

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

watch(tab, load);
onMounted(() => {
  socket.on("feed:new", onNew);
  load();
});
onUnmounted(() => socket.off("feed:new", onNew));
</script>

<template>
  <div class="relative flex flex-col">
    <header class="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
      <h1 class="text-xl font-bold">Feed</h1>
      <div class="flex rounded-full bg-surface p-1 text-xs">
        <button
          v-for="t in ['public', 'following'] as const"
          :key="t"
          class="rounded-full px-3 py-1 capitalize text-white/50"
          :class="tab === t && 'bg-surface-2 !text-white'"
          @click="tab = t"
        >
          {{ t }}
        </button>
      </div>
    </header>

    <div class="flex-1 space-y-3 overflow-y-auto px-5 pb-24">
      <p v-if="!feed.length" class="py-10 text-center text-xs text-white/30">
        {{ tab === "following" ? "Follow people to fill this tab ✨" : "Nothing here yet — be the first to post!" }}
      </p>
      <article v-for="p in feed" :key="p.id" class="rounded-2xl border border-line bg-surface p-4">
        <div class="flex items-center gap-2.5">
          <span class="grid size-9 place-items-center rounded-full bg-surface-2 text-lg">{{ p.avatar }}</span>
          <div class="flex-1">
            <p class="text-sm font-semibold">{{ p.author }}</p>
            <p class="text-[10px] text-white/35">{{ ago(p.ts) }}</p>
          </div>
          <button
            v-if="!p.mine"
            class="rounded-full px-3 py-1 text-xs font-medium"
            :class="p.following ? 'bg-surface-2 text-white/50' : 'bg-fuchsia-500/15 text-fuchsia-300'"
            @click="follow(p)"
          >
            {{ p.following ? "Following" : "+ Follow" }}
          </button>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-white/90">{{ p.text }}</p>
        <button
          class="mt-3 flex items-center gap-1.5 text-xs"
          :class="p.liked ? 'text-pink-400' : 'text-white/40'"
          @click="like(p)"
        >
          {{ p.liked ? "❤️" : "🤍" }} {{ p.likes }}
        </button>
      </article>
    </div>

    <button
      class="anim-glow absolute right-5 bottom-5 grid size-13 place-items-center rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-2xl"
      @click="composing = true"
    >
      ✏️
    </button>

    <div v-if="composing" class="absolute inset-0 z-10 flex flex-col bg-bg/95 p-5 backdrop-blur">
      <div class="flex items-center justify-between pt-[env(safe-area-inset-top)]">
        <button class="text-sm text-white/50" @click="composing = false">Cancel</button>
        <button
          class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-1.5 text-sm font-semibold disabled:opacity-40"
          :disabled="!draft.trim()"
          @click="publish"
        >
          Post
        </button>
      </div>
      <textarea
        v-model="draft"
        maxlength="500"
        placeholder="What's on your mind tonight?"
        class="mt-4 flex-1 resize-none bg-transparent text-base outline-none placeholder:text-white/25"
        autofocus
      ></textarea>
    </div>
  </div>
</template>
