<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { assetUrl, socket } from "../lib/socket";
import { pickImage } from "../lib/image";
import type { AdminItem, ShopType } from "../types";

const router = useRouter();
const TYPES: ShopType[] = ["avatar", "frame", "background", "bubble", "pet"];
const TOKEN_KEY = "sora:adminToken";

const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
const loginId = ref("");
const loginPw = ref("");
const loginError = ref("");
const busy = ref(false);

const items = ref<AdminItem[]>([]);
const filter = ref<ShopType | "all">("all");
const toast = ref("");

// editor state
const editing = ref<Partial<AdminItem> & { image?: string | null } | null>(null);

const shown = computed(() =>
  filter.value === "all" ? items.value : items.value.filter((i) => i.type === filter.value)
);

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

async function login() {
  loginError.value = "";
  busy.value = true;
  try {
    const res = await socket.emitWithAck("admin:login", { id: loginId.value, password: loginPw.value });
    if (res?.error) return (loginError.value = res.error);
    token.value = res.token;
    localStorage.setItem(TOKEN_KEY, res.token);
    await loadItems();
  } finally {
    busy.value = false;
  }
}

async function loadItems() {
  const res = await socket.emitWithAck("admin:items", { token: token.value });
  if (res?.error) {
    // token no longer valid
    token.value = null;
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  items.value = res.items;
}

function newItem() {
  editing.value = { type: "avatar", name: "", price: 300, image: null };
}
function editItem(it: AdminItem) {
  editing.value = { ...it };
}

async function chooseImage() {
  if (!editing.value) return;
  const img = await pickImage();
  if (img) editing.value.image = img;
}

async function save() {
  if (!editing.value) return;
  busy.value = true;
  try {
    const res = await socket.emitWithAck("admin:itemSave", { token: token.value, item: editing.value });
    if (res?.error) return flash(res.error);
    items.value = res.items;
    editing.value = null;
    flash("Saved");
  } finally {
    busy.value = false;
  }
}

async function del(it: AdminItem) {
  const res = await socket.emitWithAck("admin:itemDelete", { token: token.value, id: it.id });
  if (res?.error) return flash(res.error);
  items.value = res.items;
}

function logout() {
  token.value = null;
  localStorage.removeItem(TOKEN_KEY);
}

const previewSrc = computed(() => {
  const e = editing.value;
  if (!e) return "";
  return e.image ? e.image : e.src ? assetUrl(e.src) : "";
});

onMounted(() => {
  if (!socket.connected) socket.connect(); // admins may not have a user session
  if (token.value) loadItems();
});
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex items-center gap-3 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button class="text-white/50" @click="router.push('/')">←</button>
      <p class="flex-1 text-sm font-semibold">Admin · Shop items</p>
      <button v-if="token" class="text-xs text-red-300" @click="logout">Log out</button>
    </header>

    <!-- login -->
    <div v-if="!token" class="flex flex-1 flex-col items-center justify-center gap-3 px-10">
      <p class="text-sm text-white/60">Admin sign in</p>
      <input
        v-model="loginId"
        placeholder="Admin ID"
        class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-fuchsia-400/50"
      />
      <input
        v-model="loginPw"
        type="password"
        placeholder="Password"
        class="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-fuchsia-400/50"
        @keydown.enter="login"
      />
      <p v-if="loginError" class="text-xs text-red-300">{{ loginError }}</p>
      <button
        class="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold disabled:opacity-40"
        :disabled="busy || !loginId || !loginPw"
        @click="login"
      >
        Sign in
      </button>
    </div>

    <!-- item manager -->
    <template v-else>
      <div class="flex items-center gap-2 px-4 py-3">
        <select v-model="filter" class="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
          <option value="all">All types</option>
          <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <div class="flex-1"></div>
        <button class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-xs font-semibold" @click="newItem">
          + New item
        </button>
      </div>

      <div class="flex-1 space-y-2 overflow-y-auto px-4 pb-8">
        <p v-if="!shown.length" class="py-10 text-center text-xs text-white/30">No items yet — add one.</p>
        <div v-for="it in shown" :key="it.id" class="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
          <img :src="assetUrl(it.src)" class="size-12 rounded-lg bg-surface-2 object-cover" alt="" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ it.name }}</p>
            <p class="text-[10px] text-white/40">{{ it.type }} · 🪙 {{ it.price }}</p>
          </div>
          <button class="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs" @click="editItem(it)">Edit</button>
          <button class="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-300" @click="del(it)">Delete</button>
        </div>
      </div>
    </template>

    <!-- editor sheet -->
    <div v-if="editing" class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" @click.self="editing = null">
      <div class="rounded-t-3xl border-t border-line bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15"></div>
        <p class="text-sm font-semibold">{{ editing.id ? "Edit item" : "New item" }}</p>

        <div class="mt-4 flex gap-3">
          <button class="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-surface" @click="chooseImage">
            <img v-if="previewSrc" :src="previewSrc" class="size-full object-cover" alt="" />
            <span v-else class="text-[10px] text-white/40">Pick image</span>
          </button>
          <div class="flex-1 space-y-2">
            <select v-model="editing.type" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <input
              v-model="editing.name"
              maxlength="40"
              placeholder="Item name"
              class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-fuchsia-400/50"
            />
            <input
              v-model.number="editing.price"
              type="number"
              min="0"
              placeholder="Price (coins)"
              class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-fuchsia-400/50"
            />
          </div>
        </div>

        <div class="mt-4 flex gap-2.5">
          <button class="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm" @click="editing = null">Cancel</button>
          <button
            class="flex-1 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-semibold disabled:opacity-40"
            :disabled="busy || !editing.name || (!editing.id && !editing.image)"
            @click="save"
          >
            Save
          </button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg">
      {{ toast }}
    </div>
  </div>
</template>
