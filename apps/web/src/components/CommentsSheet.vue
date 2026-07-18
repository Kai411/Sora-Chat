<script setup lang="ts">
import { onMounted, ref } from "vue";
import { socket } from "../lib/socket";
import Avatar from "./Avatar.vue";
import type { Comment, Post } from "../types";

const props = defineProps<{ post: Post }>();
const emit = defineEmits<{ close: [] }>();

const comments = ref<Comment[]>([]);
const draft = ref("");
const loading = ref(true);

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

async function send() {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = "";
  const comment = await socket.emitWithAck("feed:comment", { postId: props.post.id, text });
  if (comment) {
    comments.value.push(comment);
    props.post.comments = comments.value.length;
  }
}

onMounted(async () => {
  comments.value = await socket.emitWithAck("feed:comments", { postId: props.post.id });
  loading.value = false;
});
</script>

<template>
  <div class="absolute inset-0 z-20 flex flex-col justify-end bg-black/60" @click.self="emit('close')">
    <div class="flex max-h-[75%] flex-col rounded-t-3xl border-t border-line bg-bg">
      <div class="flex items-center justify-between px-5 py-3">
        <p class="text-sm font-semibold">Comments ({{ post.comments }})</p>
        <button class="text-white/40" @click="emit('close')">✕</button>
      </div>
      <div class="flex-1 space-y-3 overflow-y-auto px-5 pb-3">
        <p v-if="!loading && !comments.length" class="py-8 text-center text-xs text-white/30">
          No comments yet — say something nice ✨
        </p>
        <div v-for="c in comments" :key="c.id" class="flex gap-2.5">
          <Avatar :avatar="c.avatar" :name="c.author" :user-id="c.userId" :frame="c.frame" size-class="size-8 text-base" />
          <div class="min-w-0">
            <p class="text-[10px] text-white/40">{{ c.author }} · {{ ago(c.ts) }}</p>
            <p class="text-sm text-white/90">{{ c.text }}</p>
          </div>
        </div>
      </div>
      <footer class="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input
          v-model="draft"
          maxlength="300"
          placeholder="Add a comment…"
          class="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
          @keydown.enter="send"
        />
        <button
          class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold disabled:opacity-40"
          :disabled="!draft.trim()"
          @click="send"
        >
          Send
        </button>
      </footer>
    </div>
  </div>
</template>
