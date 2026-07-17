<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useRoomStore } from "../stores/room";
import InitialAvatar from "../components/InitialAvatar.vue";
import type { PublicUser } from "../types";

const ROOM_CAPACITY = 20;

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const room = useRoomStore();
const roomId = String(route.params.id);

const draft = ref("");
const composing = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const gone = ref(false);
const needPin = ref(false);
const pinDraft = ref("");
const pinError = ref("");
const showMembers = ref(false);
const showInventory = ref(false);
const confirmLeave = ref(false);
const memberMenu = ref<PublicUser | null>(null);
const pickingSeatFor = ref<number | null>(null); // staff picking a seat to invite this userId to
const toast = ref("");

const CATEGORY_LABEL: Record<string, string> = { music: "Music Room", private: "Private Room", chat: "Chat Room" };

const mySeat = computed(() => (room.mySeatIndex >= 0 ? room.seats[room.mySeatIndex] : null));

function flash(msg: string) {
  toast.value = msg;
  setTimeout(() => (toast.value = ""), 2500);
}

function scrollDown() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }));
}

watch(() => room.messages.length, scrollDown);

async function tryJoin(pin?: string) {
  const res = await room.join(roomId, pin);
  if (res === true) {
    needPin.value = false;
    room.viewing = true;
    room.unread = 0;
    scrollDown();
    return;
  }
  if (res === "pin_required") needPin.value = true;
  else if (res === "pin_wrong") {
    needPin.value = true;
    pinError.value = "Wrong PIN — try again";
    pinDraft.value = "";
  } else gone.value = true;
}

function submitPin() {
  pinError.value = "";
  if (/^\d{4}$/.test(pinDraft.value)) tryJoin(pinDraft.value);
}

function openComposer() {
  composing.value = true;
  nextTick(() => inputEl.value?.focus());
}

function send() {
  const text = draft.value.trim();
  if (!text) return;
  room.send(text);
  draft.value = "";
}

function onInputBlur() {
  // Collapse back to the pill when the field is left empty.
  setTimeout(() => {
    if (!draft.value.trim()) composing.value = false;
  }, 150);
}

function tapSeat(i: number) {
  if (room.seats[i]) return; // occupied
  if (pickingSeatFor.value !== null) {
    room.inviteToSeat(pickingSeatFor.value, i);
    flash("Seat invite sent");
    pickingSeatFor.value = null;
    return;
  }
  if (mySeat.value) return;
  room.requestSeat(i);
  if (!room.isStaff) flash("Request sent to the host");
}

function roleOf(userId: number): "Host" | "Admin" | "" {
  if (userId === room.hostId) return "Host";
  if (room.admins.includes(userId)) return "Admin";
  return "";
}

function openMemberMenu(m: PublicUser) {
  if (!room.isStaff || m.id === app.user?.id) return;
  showMembers.value = false;
  memberMenu.value = m;
}

function startInvite(userId: number) {
  memberMenu.value = null;
  if (room.seats.some((s) => s?.id === userId)) return flash("They're already seated");
  pickingSeatFor.value = userId;
  flash("Tap an empty seat to invite them to it");
}

async function toggleAdmin(m: PublicUser) {
  memberMenu.value = null;
  const isAdmin = room.admins.includes(m.id);
  const err = await room.setAdmin(m.id, !isAdmin);
  if (err) flash(err);
}

function minimize() {
  // Keeps room membership; the dock takes over.
  router.back();
}

function leave() {
  room.leave();
  router.replace("/rooms");
}

onMounted(() => tryJoin());
onUnmounted(() => {
  // Deliberately NOT leaving the room — minimizing keeps membership.
  room.viewing = false;
});
</script>

<template>
  <div class="flex flex-col">
    <div v-if="gone" class="flex flex-1 flex-col items-center justify-center gap-3">
      <span class="text-5xl">🌬️</span>
      <p class="text-sm text-white/50">This room has closed</p>
      <RouterLink to="/rooms" class="text-xs text-fuchsia-300">← back to rooms</RouterLink>
    </div>

    <!-- PIN gate -->
    <div v-else-if="needPin" class="flex flex-1 flex-col items-center justify-center gap-4 px-10">
      <span class="text-5xl">🔒</span>
      <p class="text-sm text-white/60">This room is locked</p>
      <input
        v-model="pinDraft"
        maxlength="4"
        inputmode="numeric"
        placeholder="••••"
        class="w-32 rounded-xl border border-line bg-surface py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-fuchsia-400/50"
        @keydown.enter="submitPin"
      />
      <p v-if="pinError" class="text-xs text-red-300">{{ pinError }}</p>
      <button
        class="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-2.5 text-sm font-semibold disabled:opacity-40"
        :disabled="!/^\d{4}$/.test(pinDraft)"
        @click="submitPin"
      >
        Enter
      </button>
      <RouterLink to="/rooms" class="text-xs text-white/40">← back</RouterLink>
    </div>

    <template v-else>
      <header class="flex items-center gap-2.5 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button class="text-white/50" title="Minimize — you stay in the room" @click="minimize">⌄</button>
        <span class="text-xl">{{ room.room?.icon }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold">
            <span v-if="room.room?.locked">🔒</span> {{ room.room?.name ?? "…" }}
          </p>
          <p class="text-[10px] text-white/40">{{ CATEGORY_LABEL[room.room?.category ?? "chat"] }}</p>
        </div>
        <button
          class="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1.5 text-xs font-semibold"
          title="People in this room"
          @click="showMembers = true"
        >
          👥 {{ room.members.length }}/{{ ROOM_CAPACITY }}
        </button>
        <button
          class="grid size-8 place-items-center rounded-full bg-surface-2 text-sm text-red-300"
          title="Leave room"
          @click="confirmLeave = true"
        >
          ⏻
        </button>
      </header>

      <!-- seats: 2 rows × 5 columns -->
      <section class="border-b border-line px-4 py-3">
        <div class="grid grid-cols-5 gap-2">
          <button
            v-for="(seat, i) in room.seats"
            :key="i"
            class="flex flex-col items-center gap-1 rounded-xl border py-2 transition-transform active:scale-95"
            :class="[
              seat ? 'border-line bg-surface' : 'border-dashed border-white/15 bg-transparent',
              pickingSeatFor !== null && !seat && 'border-emerald-400/60',
              room.myRequestSeat === i && 'border-amber-400/60',
            ]"
            @click="tapSeat(i)"
          >
            <template v-if="seat">
              <span class="relative">
                <InitialAvatar :name="seat.nickname" :user-id="seat.id" size-class="size-9 text-sm" />
                <span
                  class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-bg text-[8px]"
                >
                  {{ seat.muted ? "🔇" : "🎙️" }}
                </span>
              </span>
              <span
                class="h-3 text-[8px] font-semibold"
                :class="roleOf(seat.id) === 'Host' ? 'text-amber-300' : 'text-sky-300'"
              >
                {{ roleOf(seat.id) }}
              </span>
            </template>
            <template v-else>
              <span class="grid size-9 place-items-center rounded-full border border-dashed border-white/15 text-white/25">＋</span>
              <span class="h-3 text-[8px] text-white/25">{{ room.myRequestSeat === i ? "asked" : "" }}</span>
            </template>
          </button>
        </div>
        <div class="mt-1.5 flex items-center justify-between">
          <p class="text-[9px] text-white/25">🎙️ live audio arrives with LiveKit (phase 2)</p>
          <button
            v-if="!mySeat && room.myRequestSeat !== null"
            class="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] text-amber-300"
            @click="room.cancelRequest()"
          >
            Cancel request
          </button>
        </div>

        <!-- pending seat requests (staff only) -->
        <div v-if="room.isStaff && room.requests.length" class="mt-2 space-y-1.5">
          <div
            v-for="r in room.requests"
            :key="r.user.id"
            class="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-1.5 text-xs"
          >
            <InitialAvatar :name="r.user.nickname" :user-id="r.user.id" size-class="size-6 text-[10px]" />
            <span class="min-w-0 flex-1 truncate text-white/70">
              {{ r.user.nickname }} wants seat {{ r.seat + 1 }}
            </span>
            <button class="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold text-black" @click="room.grantSeat(r.user.id)">
              Allow
            </button>
            <button class="rounded-full bg-surface-2 px-2.5 py-0.5 text-[10px] text-white/50" @click="room.denySeat(r.user.id)">
              Deny
            </button>
          </div>
        </div>
      </section>

      <!-- chat: all left-aligned -->
      <div ref="listEl" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <p v-if="!room.messages.length" class="py-6 text-center text-xs text-white/30">
          It's quiet in here… say hi 👋
        </p>
        <div v-for="m in room.messages" :key="m.id" class="flex items-start gap-2">
          <InitialAvatar :name="m.author" :user-id="m.userId" size-class="size-6 text-[10px]" />
          <p class="min-w-0 pt-0.5 text-sm leading-snug">
            <span class="mr-1.5 text-xs font-semibold" :class="m.userId === app.user?.id ? 'text-fuchsia-300' : 'text-sky-300'">
              {{ m.author }}
            </span>
            <span class="break-words text-white/85">{{ m.text }}</span>
          </p>
        </div>
      </div>

      <!-- bottom action bar -->
      <footer class="flex items-center gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <template v-if="!composing">
          <button
            class="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-left text-sm text-white/30"
            @click="openComposer"
          >
            Say something…
          </button>
          <button
            class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-lg"
            title="Inventory & gifts"
            @click="showInventory = true"
          >
            🎁
          </button>
          <button
            v-if="mySeat"
            class="grid size-10 shrink-0 place-items-center rounded-full text-lg"
            :class="mySeat.muted ? 'bg-white text-black' : 'bg-emerald-500/20'"
            :title="mySeat.muted ? 'Unmute' : 'Mute'"
            @click="room.setMuted(!mySeat.muted)"
          >
            {{ mySeat.muted ? "🔇" : "🎙️" }}
          </button>
          <button
            v-if="mySeat"
            class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-lg"
            title="Step down from seat"
            @click="room.leaveSeat()"
          >
            ↧
          </button>
        </template>
        <template v-else>
          <input
            ref="inputEl"
            v-model="draft"
            placeholder="Say something…"
            class="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-fuchsia-400/50"
            @keydown.enter="send"
            @blur="onInputBlur"
          />
          <button
            class="shrink-0 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
            :disabled="!draft.trim()"
            @click="send"
          >
            Send
          </button>
        </template>
      </footer>

      <!-- members sheet -->
      <div v-if="showMembers" class="absolute inset-0 z-20 flex flex-col justify-end bg-black/60" @click.self="showMembers = false">
        <div class="flex max-h-[70%] flex-col rounded-t-3xl border-t border-line bg-bg">
          <div class="flex items-center justify-between px-5 py-3">
            <p class="text-sm font-semibold">In this room ({{ room.members.length }}/{{ ROOM_CAPACITY }})</p>
            <button class="text-white/40" @click="showMembers = false">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              v-for="m in room.members"
              :key="m.id"
              class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left"
              :class="room.isStaff && m.id !== app.user?.id && 'active:bg-surface'"
              @click="openMemberMenu(m)"
            >
              <InitialAvatar :name="m.nickname" :user-id="m.id" size-class="size-10 text-sm" />
              <span class="min-w-0 flex-1 truncate text-sm">
                {{ m.nickname }} <span v-if="m.id === app.user?.id" class="text-white/30">(you)</span>
              </span>
              <span
                v-if="roleOf(m.id)"
                class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                :class="roleOf(m.id) === 'Host' ? 'bg-amber-400/15 text-amber-300' : 'bg-sky-400/15 text-sky-300'"
              >
                {{ roleOf(m.id) }}
              </span>
              <span v-if="room.seats.some((s) => s?.id === m.id)" class="text-xs" title="On a seat">🪑</span>
            </button>
          </div>
        </div>
      </div>

      <!-- inventory / gifts sheet -->
      <div v-if="showInventory" class="absolute inset-0 z-20 flex flex-col justify-end bg-black/60" @click.self="showInventory = false">
        <div class="flex max-h-[60%] flex-col rounded-t-3xl border-t border-line bg-bg">
          <div class="flex items-center justify-between px-5 py-3">
            <p class="text-sm font-semibold">🎁 Your items ({{ app.inventory.length }})</p>
            <button class="text-white/40" @click="showInventory = false">✕</button>
          </div>
          <p class="px-5 text-[10px] text-white/35">Gifting & in-room minigames arrive in a later update</p>
          <div class="grid flex-1 grid-cols-4 gap-2 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div v-for="(item, i) in app.inventory" :key="i" class="rounded-xl border border-line bg-surface p-2 text-center">
              <div class="text-2xl">{{ item.icon }}</div>
              <p class="mt-1 truncate text-[9px] text-white/50">{{ item.name }}</p>
            </div>
            <p v-if="!app.inventory.length" class="col-span-4 py-8 text-center text-xs text-white/30">
              Nothing yet — try the gacha ✨
            </p>
          </div>
        </div>
      </div>

      <!-- leave confirm -->
      <div v-if="confirmLeave" class="absolute inset-0 z-30 grid place-items-center bg-black/60 px-10" @click.self="confirmLeave = false">
        <div class="w-full rounded-2xl border border-line bg-surface p-5 text-center">
          <p class="text-sm font-semibold">Leave this room?</p>
          <p class="mt-1 text-xs text-white/40">You'll give up your seat and roles.</p>
          <div class="mt-4 flex gap-3">
            <button class="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm" @click="confirmLeave = false">Stay</button>
            <button class="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold" @click="leave">Leave</button>
          </div>
        </div>
      </div>

      <!-- staff member menu -->
      <div
        v-if="memberMenu"
        class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60"
        @click.self="memberMenu = null"
      >
        <div class="rounded-t-3xl border-t border-line bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div class="flex items-center justify-center gap-2">
            <InitialAvatar :name="memberMenu.nickname" :user-id="memberMenu.id" size-class="size-8 text-xs" />
            <p class="text-sm font-semibold">{{ memberMenu.nickname }}</p>
          </div>
          <div class="mt-4 space-y-2">
            <button class="w-full rounded-xl bg-surface py-3 text-sm" @click="startInvite(memberMenu!.id)">
              🪑 Invite to a seat
            </button>
            <button
              v-if="room.isHost"
              class="w-full rounded-xl bg-surface py-3 text-sm"
              @click="toggleAdmin(memberMenu!)"
            >
              {{ room.admins.includes(memberMenu!.id) ? "🛡️ Remove admin" : "🛡️ Make admin (max 2)" }}
            </button>
            <button class="w-full rounded-xl border border-line py-3 text-sm text-white/50" @click="memberMenu = null">
              Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- seat invite prompt -->
      <div
        v-if="room.inviteSeat !== null"
        class="absolute inset-x-3 top-3 z-30 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-surface-2/95 p-3.5 shadow-xl backdrop-blur"
      >
        <span class="text-2xl">🪑</span>
        <p class="min-w-0 flex-1 text-xs text-white/80">
          The host invites you to <b>seat {{ room.inviteSeat + 1 }}</b>
        </p>
        <button class="rounded-full bg-surface px-3 py-1.5 text-xs text-white/50" @click="room.declineInvite()">
          Not now
        </button>
        <button class="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black" @click="room.acceptInvite()">
          Take seat
        </button>
      </div>

      <div
        v-if="toast"
        class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg"
      >
        {{ toast }}
      </div>
    </template>
  </div>
</template>
