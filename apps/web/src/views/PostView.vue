<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { socket } from "../lib/socket";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import PostCard from "../components/PostCard.vue";
import type { Comment, Post } from "../types";

const route = useRoute();
const router = useRouter();
const postId = Number(route.params.id);

const post = ref<Post | null>(null);
const comments = ref<Comment[]>([]);
const draft = ref("");
const loading = ref(true);
const missing = ref(false);
const showMenu = ref(false);
const confirmDelete = ref(false);
const toast = ref("");

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2000);
}

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function onCommented({ postId: pid, comments: count }: { postId: number; comments: number }) {
  if (post.value && pid === postId) post.value.comments = count;
}

function onRemoved({ postId: pid }: { postId: number }) {
  if (pid === postId) {
    post.value = null;
    missing.value = true;
  }
}

async function send() {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = "";
  const comment = await socket.emitWithAck("feed:comment", { postId, text });
  if (comment) {
    comments.value.push(comment);
    if (post.value) post.value.comments = comments.value.length;
  }
}

async function deletePost() {
  confirmDelete.value = false;
  showMenu.value = false;
  const res = await socket.emitWithAck("feed:delete", { id: postId });
  if (res?.error) return flash(res.error);
  router.back();
}

function soon(what: string) {
  showMenu.value = false;
  flash(`${what} is coming soon`);
}

onMounted(async () => {
  socket.on("feed:commented", onCommented);
  socket.on("feed:removed", onRemoved);
  post.value = await socket.emitWithAck("feed:one", { id: postId });
  if (!post.value) {
    missing.value = true;
    loading.value = false;
    return;
  }
  comments.value = await socket.emitWithAck("feed:comments", { postId });
  loading.value = false;
});
onUnmounted(() => {
  socket.off("feed:commented", onCommented);
  socket.off("feed:removed", onRemoved);
});
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <p class="flex-1 text-sm font-semibold">Post</p>
      <button
        v-if="post"
        class="grid size-8 place-items-center rounded-full bg-surface-2 text-white/60"
        title="Post options"
        @click="showMenu = true"
      >
        <Icon name="gear" cls="size-4" />
      </button>
    </header>

    <div v-if="missing" class="flex flex-1 items-center justify-center text-sm text-white/40">
      This post is gone
    </div>

    <div v-else class="flex-1 overflow-y-auto px-4 pb-4">
      <PostCard v-if="post" :post="post" show-follow full />

      <!-- comments, inline -->
      <section class="mt-5">
        <h2 class="text-xs font-semibold text-white/60">Comments ({{ post?.comments ?? 0 }})</h2>
        <p v-if="!loading && !comments.length" class="py-8 text-center text-xs text-white/30">
          No comments yet — say something nice ✨
        </p>
        <div class="mt-3 space-y-3.5">
          <div v-for="c in comments" :key="c.id" class="flex gap-2.5">
            <button class="shrink-0" @click="router.push(`/u/${c.userId}`)">
              <Avatar :avatar="c.avatar" :name="c.author" :user-id="c.userId" :frame="c.frame" size-class="size-8 text-base" />
            </button>
            <div class="min-w-0">
              <p class="text-[10px] text-white/40">{{ c.author }} · {{ ago(c.ts) }}</p>
              <p class="text-sm whitespace-pre-line text-white/90">{{ c.text }}</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <footer v-if="!missing" class="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <input
        v-model="draft"
        maxlength="300"
        placeholder="Add a comment…"
        class="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
        @keydown.enter="send"
      />
      <button
        class="shrink-0 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold disabled:opacity-40"
        :disabled="!draft.trim()"
        @click="send"
      >
        Send
      </button>
    </footer>

    <!-- post options sheet -->
    <div v-if="showMenu" class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" @click.self="showMenu = false">
      <div class="rounded-t-3xl border-t border-line bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15"></div>
        <div class="space-y-2">
          <button class="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-white/60" @click="soon('Pin to top')">
            <Icon name="pin" cls="size-4" /> Pin to top <span class="ml-auto text-[10px] text-white/30">soon</span>
          </button>
          <button class="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-white/60" @click="soon('Sharing')">
            <Icon name="share" cls="size-4" /> Share <span class="ml-auto text-[10px] text-white/30">soon</span>
          </button>
          <button
            v-if="post?.mine"
            class="flex w-full items-center gap-3 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-300"
            @click="confirmDelete = true; showMenu = false"
          >
            <Icon name="trash" cls="size-4" /> Delete post
          </button>
        </div>
      </div>
    </div>

    <!-- delete confirm -->
    <div v-if="confirmDelete" class="absolute inset-0 z-30 grid place-items-center bg-black/60 px-10" @click.self="confirmDelete = false">
      <div class="w-full rounded-2xl border border-line bg-surface p-5 text-center">
        <p class="text-sm font-semibold">Delete this post?</p>
        <p class="mt-1 text-xs text-white/40">Its comments and likes go with it. This can't be undone.</p>
        <div class="mt-4 flex gap-3">
          <button class="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm" @click="confirmDelete = false">Keep</button>
          <button class="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold" @click="deletePost">Delete</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg">
      {{ toast }}
    </div>
  </div>
</template>
