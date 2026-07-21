<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "../lib/supabase";
import { useAppStore } from "../stores/app";

const app = useAppStore();
const router = useRouter();

const configured = !!supabase;
const mode = ref<"signin" | "signup">("signin");
const email = ref("");
const password = ref("");
const nickname = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");

// Set once we know this address needs to click a confirmation link — either
// right after signing up, or because sign-in was blocked on it.
const pendingConfirm = ref<string | null>(null);
const resendCooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

function startCooldown() {
  resendCooldown.value = 30;
  cooldownTimer = setInterval(() => {
    resendCooldown.value--;
    if (resendCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
}
onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});

async function resend() {
  if (!pendingConfirm.value || resendCooldown.value > 0) return;
  error.value = "";
  notice.value = "";
  try {
    await app.resendConfirmation(pendingConfirm.value);
    notice.value = "Confirmation email sent again — check your inbox (and spam folder).";
    startCooldown();
  } catch (e: any) {
    error.value = e?.message ?? "Could not resend the email";
  }
}

function useDifferentEmail() {
  pendingConfirm.value = null;
  notice.value = "";
  error.value = "";
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    if (mode.value === "signup") {
      const result = await app.signUp({
        email: email.value,
        password: password.value,
        nickname: nickname.value.trim(),
      });
      if (result === "confirm") {
        pendingConfirm.value = email.value;
        return;
      }
    } else {
      await app.signIn({ email: email.value, password: password.value });
    }
    router.replace("/");
  } catch (e: any) {
    if (e?.message === "EMAIL_NOT_CONFIRMED") {
      pendingConfirm.value = email.value;
      error.value = "Please confirm your email before signing in.";
    } else {
      error.value = e?.message ?? "Something went wrong";
    }
  } finally {
    busy.value = false;
  }
}

async function google() {
  error.value = "";
  try {
    await app.signInGoogle(); // navigates away on success
  } catch (e: any) {
    error.value = e?.message ?? "Google sign-in failed";
  }
}

async function forgot() {
  error.value = "";
  notice.value = "";
  if (!email.value) {
    error.value = "Type your email above first";
    return;
  }
  try {
    await app.resetPassword(email.value);
    notice.value = "Password reset email sent — check your inbox.";
  } catch (e: any) {
    error.value = e?.message ?? "Could not send the reset email";
  }
}
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

    <div v-if="!configured" class="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-xs text-amber-200">
      Auth isn't configured yet: set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
      (see <code>apps/web/.env.example</code>), then restart the dev server.
    </div>

    <!-- confirmation pending: fresh signup, waiting on the email link -->
    <div v-else-if="pendingConfirm && mode === 'signup'" class="w-full space-y-4 text-center">
      <div class="text-5xl">📬</div>
      <div>
        <p class="text-sm font-semibold">Check your inbox</p>
        <p class="mt-1 text-xs text-white/50">
          We sent a confirmation link to <span class="text-white/80">{{ pendingConfirm }}</span
          >. Click it, then come back here and sign in.
        </p>
      </div>
      <button
        class="w-full rounded-xl bg-surface py-3 text-sm font-medium text-fuchsia-300 disabled:opacity-40"
        :disabled="resendCooldown > 0"
        @click="resend"
      >
        {{ resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend confirmation email" }}
      </button>
      <button class="w-full text-center text-xs text-white/40" @click="mode = 'signin'; useDifferentEmail()">
        Back to sign in
      </button>
      <button class="w-full text-center text-xs text-white/30" @click="useDifferentEmail">Use a different email</button>
      <p v-if="error" class="text-center text-xs text-red-300">{{ error }}</p>
      <p v-if="notice" class="text-center text-xs text-emerald-300">{{ notice }}</p>
    </div>

    <div v-else class="w-full space-y-4">
      <div class="flex rounded-full bg-surface p-1 text-sm">
        <button
          v-for="m in [
            { id: 'signin', label: 'Sign in' },
            { id: 'signup', label: 'Create account' },
          ] as const"
          :key="m.id"
          class="flex-1 rounded-full py-1.5 text-white/50"
          :class="mode === m.id && 'bg-surface-2 !text-white'"
          @click="mode = m.id; error = ''; notice = ''; pendingConfirm = null"
        >
          {{ m.label }}
        </button>
      </div>

      <input
        v-if="mode === 'signup'"
        v-model="nickname"
        maxlength="20"
        placeholder="Nickname"
        class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
      />

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

      <button v-if="mode === 'signin'" class="w-full text-center text-xs text-white/40" @click="forgot">
        Forgot password?
      </button>

      <p v-if="error" class="text-center text-xs text-red-300">{{ error }}</p>
      <p v-if="notice" class="text-center text-xs text-emerald-300">{{ notice }}</p>

      <!-- sign-in blocked on confirmation: offer resend without losing the form -->
      <div v-if="pendingConfirm && mode === 'signin'" class="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-center">
        <p class="text-xs text-amber-200">Haven't confirmed <span class="text-white/90">{{ pendingConfirm }}</span> yet?</p>
        <button
          class="mt-1.5 text-xs font-semibold text-fuchsia-300 disabled:opacity-40"
          :disabled="resendCooldown > 0"
          @click="resend"
        >
          {{ resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend confirmation email" }}
        </button>
      </div>

      <div class="pt-1">
        <div class="mb-3 flex items-center gap-3 text-[10px] text-white/30">
          <span class="h-px flex-1 bg-line"></span>OR<span class="h-px flex-1 bg-line"></span>
        </div>
        <button
          class="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-white py-3 text-sm font-semibold text-black transition-transform active:scale-95"
          @click="google"
        >
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
          Continue with Google
        </button>
      </div>
    </div>
  </div>
</template>
