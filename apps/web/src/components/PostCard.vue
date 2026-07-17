<script setup lang="ts">
import { useRouter } from "vue-router";
import { serverBase, socket } from "../lib/socket";
import Avatar from "./Avatar.vue";
import type { Post } from "../types";

const props = defineProps<{ post: Post; showFollow?: boolean }>();
const emit = defineEmits<{ comments: [post: Post]; followed: [userId: number, following: boolean] }>();
const router = useRouter();

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

async function like() {
  const res = await socket.emitWithAck("feed:like", { id: props.post.id });
  if (res) Object.assign(props.post, res);
}

async function follow() {
  const res = await socket.emitWithAck("user:follow", { userId: props.post.userId });
  if (res) emit("followed", res.userId, res.following);
}
</script>

<template>
  <article class="rounded-2xl border border-line bg-surface p-4">
    <div class="flex items-center gap-2.5">
      <button class="flex min-w-0 flex-1 items-center gap-2.5 text-left" @click="router.push(`/u/${post.userId}`)">
        <Avatar :avatar="post.avatar" :name="post.author" :user-id="post.userId" size-class="size-9 text-lg" />
        <span class="min-w-0">
          <span class="block truncate text-sm font-semibold">{{ post.author }}</span>
          <span class="block text-[10px] text-white/35">{{ ago(post.ts) }}</span>
        </span>
      </button>
      <button
        v-if="showFollow && !post.mine"
        class="rounded-full px-3 py-1 text-xs font-medium"
        :class="post.following ? 'bg-surface-2 text-white/50' : 'bg-fuchsia-500/15 text-fuchsia-300'"
        @click="follow"
      >
        {{ post.following ? "Following" : "+ Follow" }}
      </button>
    </div>
    <p v-if="post.text" class="mt-3 text-sm leading-relaxed text-white/90">{{ post.text }}</p>
    <img
      v-if="post.image"
      :src="serverBase + post.image"
      class="mt-3 max-h-96 w-full rounded-xl object-cover"
      loading="lazy"
      alt=""
    />
    <div class="mt-3 flex items-center gap-5 text-xs">
      <button class="flex items-center gap-1.5" :class="post.liked ? 'text-pink-400' : 'text-white/40'" @click="like">
        {{ post.liked ? "❤️" : "🤍" }} {{ post.likes }}
      </button>
      <button class="flex items-center gap-1.5 text-white/40" @click="emit('comments', post)">
        💬 {{ post.comments }}
      </button>
    </div>
  </article>
</template>
