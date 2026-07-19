<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { socket } from "../lib/socket";
import { useAppStore } from "../stores/app";
import { pickImage } from "../lib/image";
import PostCard from "../components/PostCard.vue";
import type { Post } from "../types";

const app = useAppStore();
const router = useRouter();
const tab = ref<"public" | "following">("public");
const feed = ref<Post[]>([]);
const draft = ref("");
const draftImage = ref<string | null>(null);
const composing = ref(false);
const posting = ref(false);
const error = ref("");

async function load() {
  feed.value = await socket.emitWithAck("feed:list", { tab: tab.value });
}

function onNew({ post }: { post: Post }) {
  if (tab.value === "public" && !feed.value.some((p) => p.id === post.id)) {
    feed.value.unshift({ ...post, mine: post.userId === app.user?.id });
  }
}

function onCommented({ postId, comments }: { postId: number; comments: number }) {
  const p = feed.value.find((x) => x.id === postId);
  if (p) p.comments = comments;
}

function onRemoved({ postId }: { postId: number }) {
  feed.value = feed.value.filter((p) => p.id !== postId);
}

async function attach() {
  draftImage.value = (await pickImage()) ?? draftImage.value;
}

async function publish() {
  if (posting.value) return;
  posting.value = true;
  error.value = "";
  try {
    const res = await socket.emitWithAck("feed:post", { text: draft.value.trim(), image: draftImage.value });
    if (res?.error) return void (error.value = res.error);
    if (res && !feed.value.some((p) => p.id === res.id)) feed.value.unshift(res);
    draft.value = "";
    draftImage.value = null;
    composing.value = false;
  } finally {
    posting.value = false;
  }
}

function onFollowed(userId: number, following: boolean) {
  for (const p of feed.value) if (p.userId === userId) p.following = following;
}

watch(tab, load);
onMounted(() => {
  socket.on("feed:new", onNew);
  socket.on("feed:commented", onCommented);
  socket.on("feed:removed", onRemoved);
  load();
});
onUnmounted(() => {
  socket.off("feed:new", onNew);
  socket.off("feed:commented", onCommented);
  socket.off("feed:removed", onRemoved);
});
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
      <PostCard
        v-for="p in feed"
        :key="p.id"
        :post="p"
        show-follow
        @open="router.push(`/post/${$event.id}`)"
        @followed="onFollowed"
      />
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
        <div class="flex items-center gap-3">
          <button class="grid size-9 place-items-center rounded-full bg-surface text-lg" title="Add photo" @click="attach">
            📷
          </button>
          <button
            class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-1.5 text-sm font-semibold disabled:opacity-40"
            :disabled="posting || (!draft.trim() && !draftImage)"
            @click="publish"
          >
            {{ posting ? "Posting…" : "Post" }}
          </button>
        </div>
      </div>
      <p v-if="error" class="mt-2 text-xs text-red-300">{{ error }}</p>
      <textarea
        v-model="draft"
        maxlength="500"
        placeholder="What's on your mind tonight?"
        class="mt-4 flex-1 resize-none bg-transparent text-base outline-none placeholder:text-white/25"
        autofocus
      ></textarea>
      <div v-if="draftImage" class="relative mb-2">
        <img :src="draftImage" class="max-h-52 w-full rounded-xl object-cover" alt="" />
        <button
          class="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/70 text-xs"
          @click="draftImage = null"
        >
          ✕
        </button>
      </div>
    </div>

  </div>
</template>
