<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";

const app = useAppStore();
const router = useRouter();

const section = ref<"account">("account");
const nameDraft = ref(app.user?.nickname ?? "");
const toast = ref("");

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

async function saveName() {
  const err = await app.rename(nameDraft.value);
  flash(err ?? "Name updated");
}

async function logout() {
  await app.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.back()">←</button>
      <p class="text-sm font-semibold">Settings</p>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- category rail (single category for now, room to grow) -->
      <nav class="w-28 shrink-0 space-y-1 border-r border-line p-2">
        <button
          class="w-full rounded-lg px-3 py-2 text-left text-xs font-medium"
          :class="section === 'account' ? 'bg-surface-2 text-white' : 'text-white/50'"
          @click="section = 'account'"
        >
          Account
        </button>
        <p class="px-3 pt-2 text-[10px] text-white/25">More coming soon</p>
      </nav>

      <div class="flex-1 overflow-y-auto p-5">
        <template v-if="section === 'account'">
          <h2 class="text-sm font-semibold text-white/70">Account</h2>

          <label class="mt-4 block text-xs text-white/50">Display name</label>
          <div class="mt-1.5 flex gap-2">
            <input
              v-model="nameDraft"
              maxlength="20"
              class="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-fuchsia-400/50"
            />
            <button
              class="shrink-0 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-sm font-semibold disabled:opacity-40"
              :disabled="!nameDraft.trim() || nameDraft.trim() === app.user?.nickname"
              @click="saveName"
            >
              Save
            </button>
          </div>

          <div class="mt-6 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
            <span class="text-sm text-white/60">Coins</span>
            <span class="text-sm font-semibold">🪙 {{ app.coins.toLocaleString() }}</span>
          </div>

          <button class="mt-8 w-full rounded-xl border border-line bg-surface py-3 text-sm text-red-300" @click="logout">
            Log out
          </button>
        </template>
      </div>
    </div>

    <div v-if="toast" class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg">
      {{ toast }}
    </div>
  </div>
</template>
