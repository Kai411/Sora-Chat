<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";

const AVATARS = ["🦊", "🐰", "🐼", "🐸", "🦄", "🐙", "🐧", "🦋", "🌸", "🍀", "🎧", "🌙"];

const app = useAppStore();
const router = useRouter();
const nickname = ref("");
const avatar = ref(AVATARS[0]);
const busy = ref(false);
const error = ref("");

async function enter() {
  const name = nickname.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await app.login(name, avatar.value);
    router.replace("/");
  } catch {
    error.value = "Can't reach the server. Please try again in a moment.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-8 overflow-y-auto px-8 py-10">
    <div class="text-center">
      <div class="anim-float text-6xl">🪽</div>
      <h1
        class="mt-3 bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-4xl font-extrabold text-transparent"
      >
        Sora
      </h1>
      <p class="mt-1 text-sm text-white/50">Meet someone new tonight</p>
    </div>

    <div class="w-full space-y-5">
      <div>
        <label class="mb-2 block text-xs font-medium text-white/50">PICK AN AVATAR</label>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="a in AVATARS"
            :key="a"
            class="rounded-xl bg-surface py-2 text-2xl transition-transform active:scale-90"
            :class="avatar === a && 'ring-2 ring-fuchsia-400 bg-surface-2'"
            @click="avatar = a"
          >
            {{ a }}
          </button>
        </div>
      </div>

      <div>
        <label class="mb-2 block text-xs font-medium text-white/50">NICKNAME</label>
        <input
          v-model="nickname"
          maxlength="20"
          placeholder="What should we call you?"
          class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
          @keydown.enter="enter"
        />
      </div>

      <button
        class="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 font-semibold transition-transform active:scale-95 disabled:opacity-40"
        :disabled="!nickname.trim() || busy"
        @click="enter"
      >
        {{ busy ? "Entering…" : "Enter Sora" }}
      </button>

      <p v-if="error" class="text-center text-xs text-red-300">{{ error }}</p>
    </div>
  </div>
</template>
