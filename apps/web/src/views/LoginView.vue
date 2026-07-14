<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";

const AVATARS = ["🦊", "🐰", "🐼", "🐸", "🦄", "🐙", "🐧", "🦋", "🌸", "🍀", "🎧", "🌙"];
const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const app = useAppStore();
const router = useRouter();

const mode = ref<"signin" | "signup">("signin");
const email = ref("");
const password = ref("");
const nickname = ref("");
const avatar = ref(AVATARS[0]);
const busy = ref(false);
const error = ref("");
const googleEl = ref<HTMLElement | null>(null);

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (mode.value === "signup") {
      await app.register({
        email: email.value,
        password: password.value,
        nickname: nickname.value,
        avatar: avatar.value,
      });
    } else {
      await app.login({ email: email.value, password: password.value });
    }
    router.replace("/");
  } catch (e: any) {
    error.value = e?.message ?? "Something went wrong";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (!GOOGLE_CLIENT_ID) return;
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.onload = () => {
    const google = (window as any).google;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async ({ credential }: { credential: string }) => {
        error.value = "";
        try {
          await app.loginGoogle(credential);
          router.replace("/");
        } catch (e: any) {
          error.value = e?.message ?? "Google sign-in failed";
        }
      },
    });
    if (googleEl.value) {
      google.accounts.id.renderButton(googleEl.value, { theme: "filled_black", size: "large", width: 320 });
    }
  };
  document.head.appendChild(script);
});
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-7 overflow-y-auto px-8 py-10">
    <div class="text-center">
      <div class="anim-float text-6xl">🪽</div>
      <h1
        class="mt-3 bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-4xl font-extrabold text-transparent"
      >
        Sora
      </h1>
      <p class="mt-1 text-sm text-white/50">Meet someone new tonight</p>
    </div>

    <div class="w-full space-y-4">
      <div class="flex rounded-full bg-surface p-1 text-sm">
        <button
          v-for="m in [
            { id: 'signin', label: 'Sign in' },
            { id: 'signup', label: 'Create account' },
          ] as const"
          :key="m.id"
          class="flex-1 rounded-full py-1.5 text-white/50"
          :class="mode === m.id && 'bg-surface-2 !text-white'"
          @click="mode = m.id; error = ''"
        >
          {{ m.label }}
        </button>
      </div>

      <template v-if="mode === 'signup'">
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
        <input
          v-model="nickname"
          maxlength="20"
          placeholder="Nickname"
          class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
        />
      </template>

      <input
        v-model="email"
        type="email"
        placeholder="Email"
        class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
      />
      <input
        v-model="password"
        type="password"
        :placeholder="mode === 'signup' ? 'Password (8+ characters)' : 'Password'"
        class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
        @keydown.enter="submit"
      />

      <button
        class="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 font-semibold transition-transform active:scale-95 disabled:opacity-40"
        :disabled="busy || !email || !password || (mode === 'signup' && !nickname.trim())"
        @click="submit"
      >
        {{ busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in" }}
      </button>

      <p v-if="error" class="text-center text-xs text-red-300">{{ error }}</p>

      <div v-if="GOOGLE_CLIENT_ID" class="pt-1">
        <div class="mb-3 flex items-center gap-3 text-[10px] text-white/30">
          <span class="h-px flex-1 bg-line"></span>OR<span class="h-px flex-1 bg-line"></span>
        </div>
        <div ref="googleEl" class="flex justify-center"></div>
      </div>
    </div>
  </div>
</template>
