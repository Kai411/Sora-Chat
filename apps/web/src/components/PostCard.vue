<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { assetUrl, socket } from "../lib/socket";
import Avatar from "./Avatar.vue";
import Icon from "./Icon.vue";
import type { Post } from "../types";

const props = defineProps<{
  post: Post;
  showFollow?: boolean;
  /** true on the post's own page: full text, no open-navigation */
  full?: boolean;
}>();
const emit = defineEmits<{ open: [post: Post]; followed: [userId: number, following: boolean] }>();
const router = useRouter();

const shareNote = ref(false);

// Long posts (>= 4 lines, or wrap-equivalent length) preview at 2 lines.
const isLong = computed(() => {
  const t = props.post.text ?? "";
  return t.split("\n").length >= 4 || t.length >= 200;
});
const clamped = computed(() => !props.full && isLong.value);

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function open() {
  if (!props.full) emit("open", props.post);
}

async function like() {
  const res = await socket.emitWithAck("feed:like", { id: props.post.id });
  if (res) Object.assign(props.post, res);
}

async function follow() {
  const res = await socket.emitWithAck("user:follow", { userId: props.post.userId });
  if (res) emit("followed", res.userId, res.following);
}

function share() {
  shareNote.value = true;
  setTimeout(() => (shareNote.value = false), 1800);
}
</script>

<template>
  <article class="rounded-2xl border border-line bg-surface p-4">
    <div class="flex items-center gap-2.5">
      <button class="flex min-w-0 flex-1 items-center gap-2.5 text-left" @click="router.push(`/u/${post.userId}`)">
        <Avatar :avatar="post.avatar" :name="post.author" :user-id="post.userId" :frame="post.authorFrame" size-class="size-9 text-lg" />
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

    <!-- body: tapping opens the post page -->
    <div :class="!full && 'cursor-pointer'" @click="open">
      <p
        v-if="post.text"
        class="mt-3 text-sm leading-relaxed whitespace-pre-line text-white/90"
        :class="clamped && 'line-clamp-2'"
      >
        {{ post.text }}
      </p>
      <button v-if="clamped" class="mt-0.5 text-xs font-medium text-fuchsia-300">view more</button>
      <img
        v-if="post.image"
        :src="assetUrl(post.image)"
        class="mt-3 max-h-96 w-full rounded-xl object-cover"
        loading="lazy"
        alt=""
      />
    </div>

    <div class="mt-2 flex items-center gap-4 text-xs">
      <button class="-m-2 flex items-center gap-1.5 p-2" :class="post.liked ? 'text-red-400' : 'text-white/40'" @click="like">
        <Icon name="heart" cls="size-4.5" :class="post.liked && 'fill-red-400'" />
        <span class="tabular-nums">{{ post.likes }}</span>
      </button>
      <button class="-m-2 flex items-center gap-1.5 p-2 text-white/40" @click="open">
        <Icon name="chat" cls="size-4.5" />
        <span class="tabular-nums">{{ post.comments }}</span>
      </button>
      <button class="-m-2 flex items-center gap-1.5 p-2 text-white/40" title="Share" @click="share">
        <Icon name="share" cls="size-4.5" />
      </button>
      <span v-if="shareNote" class="text-[10px] text-white/40">Sharing coming soon</span>
    </div>
  </article>
</template>
