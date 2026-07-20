<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { socket } from "../lib/socket";
import Avatar from "../components/Avatar.vue";
import type { PublicUser } from "../types";

const route = useRoute();
const router = useRouter();
const userId = computed(() => Number(route.params.id));

type Tab = "followers" | "following" | "friends";
const tab = ref<Tab>((route.query.tab as Tab) || "followers");
const followers = ref<PublicUser[]>([]);
const following = ref<PublicUser[]>([]);
const loading = ref(true);

// A friend is a mutual follow — appears in both lists.
const friends = computed(() => {
  const followingIds = new Set(following.value.map((u) => u.id));
  return followers.value.filter((u) => followingIds.has(u.id));
});

const shown = computed(() => (tab.value === "followers" ? followers.value : tab.value === "following" ? following.value : friends.value));

async function load() {
  loading.value = true;
  const res = await socket.emitWithAck("user:follows", { userId: userId.value });
  if (res) {
    followers.value = res.followers;
    following.value = res.following;
  }
  loading.value = false;
}

function goUser(u: PublicUser) {
  router.push(`/u/${u.id}`);
}

watch(() => route.params.id, load);
onMounted(load);
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <p class="text-sm font-semibold">Connections</p>
    </header>

    <div class="px-5 pb-3">
      <div class="flex rounded-full bg-surface p-1 text-xs">
        <button
          v-for="t in [
            { id: 'followers', label: 'Followers' },
            { id: 'following', label: 'Following' },
            { id: 'friends', label: 'Friends' },
          ] as const"
          :key="t.id"
          class="flex-1 rounded-full py-1.5 text-white/50"
          :class="tab === t.id && 'bg-surface-2 !text-white'"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-5 pb-8">
      <p v-if="!loading && !shown.length" class="py-16 text-center text-xs text-white/30">
        {{
          tab === "followers"
            ? "No followers yet"
            : tab === "following"
              ? "Not following anyone yet"
              : "No friends yet — friends are people who follow each other"
        }}
      </p>
      <button
        v-for="u in shown"
        :key="u.id"
        class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-surface"
        @click="goUser(u)"
      >
        <Avatar :avatar="u.avatar" :name="u.nickname" :user-id="u.id" :frame="u.frame" size-class="size-11 text-lg" />
        <span class="min-w-0 flex-1 truncate text-sm">
          {{ u.nickname }}
          <span v-if="u.vip" class="ml-1 rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1 text-[9px] font-bold text-black">VIP</span>
        </span>
      </button>
    </div>
  </div>
</template>
