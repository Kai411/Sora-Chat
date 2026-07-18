<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useRoomStore } from "../stores/room";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import SeatCell from "../components/SeatCell.vue";
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
const banned = ref(false);
const needPin = ref(false);
const pinDraft = ref("");
const pinError = ref("");
const showMembers = ref(false);
const showInventory = ref(false);
const showLock = ref(false);
const lockPin = ref("");
const lockError = ref("");
const showMenu = ref(false);
const showBackgrounds = ref(false);
const bgOptions = ref<{ id: string; src: string }[]>([]);
const confirmLeave = ref(false);

async function openBackgrounds() {
  showMenu.value = false;
  bgOptions.value = await room.backgrounds();
  showBackgrounds.value = true;
}
const card = ref<PublicUser | null>(null); // mini profile popup
const pickingSeatFor = ref<number | null>(null);
const toast = ref("");

const mySeat = computed(() => (room.mySeatIndex >= 0 ? room.seats[room.mySeatIndex] : null));
const cardSeat = computed(() => (card.value ? room.seats.find((s) => s?.id === card.value!.id) ?? null : null));
const cardRole = computed(() => (card.value ? roleOf(card.value.id) : ""));

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
  } else if (res === "banned") banned.value = true;
  else gone.value = true;
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
  setTimeout(() => {
    if (!draft.value.trim()) composing.value = false;
  }, 150);
}

function roleOf(userId: number): "Host" | "Admin" | "" {
  if (userId === room.hostId) return "Host";
  if (room.admins.includes(userId)) return "Admin";
  return "";
}

function tapSeat(i: number) {
  const seat = room.seats[i];
  if (seat) {
    openCard(seat);
    return;
  }
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

function openCard(u: PublicUser) {
  showMembers.value = false;
  card.value = u;
}

function startInvite(userId: number) {
  card.value = null;
  if (room.seats.some((s) => s?.id === userId)) return flash("They're already seated");
  pickingSeatFor.value = userId;
  flash("Tap an empty seat to invite them to it");
}

async function toggleAdmin(u: PublicUser) {
  card.value = null;
  const err = await room.setAdmin(u.id, !room.admins.includes(u.id));
  if (err) flash(err);
}

function doKick(u: PublicUser) {
  card.value = null;
  room.kick(u.id);
  flash(`${u.nickname} was removed from the room`);
}

async function applyLock(lock: boolean) {
  lockError.value = "";
  if (lock && !/^\d{4}$/.test(lockPin.value)) return (lockError.value = "PIN must be exactly 4 digits");
  const err = await room.setPin(lock ? lockPin.value : null);
  if (err) return (lockError.value = err);
  showLock.value = false;
  lockPin.value = "";
  flash(lock ? "Room locked 🔒" : "Room unlocked");
}

function minimize() {
  router.back();
}

function leave() {
  room.leave();
  router.replace("/rooms");
}

function viewProfile(u: PublicUser) {
  card.value = null;
  router.push(`/u/${u.id}`);
}

onMounted(() => {
  room.kickedFrom = null;
  tryJoin();
});
onUnmounted(() => {
  // Deliberately NOT leaving the room — minimizing keeps membership.
  room.viewing = false;
});
</script>

<template>
  <div class="relative isolate flex flex-col">
    <div v-if="gone || banned || room.kickedFrom" class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <Icon :name="banned || room.kickedFrom ? 'user-x' : 'x'" cls="size-12 text-white/30" />
      <p class="text-sm text-white/60">
        {{
          room.kickedFrom
            ? `You were removed from ${room.kickedFrom}`
            : banned
              ? "You can't rejoin this room — the host removed you"
              : "This room has closed"
        }}
      </p>
      <RouterLink to="/rooms" class="text-xs text-fuchsia-300" @click="room.kickedFrom = null">← back to rooms</RouterLink>
    </div>

    <!-- PIN gate -->
    <div v-else-if="needPin" class="flex flex-1 flex-col items-center justify-center gap-4 px-10">
      <Icon name="lock" cls="size-12 text-white/40" />
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
      <!-- room background -->
      <div v-if="room.background" class="pointer-events-none absolute inset-0 -z-10">
        <img :src="room.background" class="size-full object-cover" alt="" />
        <div class="absolute inset-0 bg-bg/72"></div>
      </div>

      <header class="flex items-center gap-2 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-1 truncate text-sm font-semibold">
            <Icon v-if="room.locked" name="lock" cls="size-3 shrink-0 text-white/50" />
            {{ room.room?.name ?? "…" }}
          </p>
        </div>
        <button
          class="grid size-8 place-items-center rounded-full bg-surface-2 text-white/60"
          title="Room menu"
          @click="showMenu = true"
        >
          <Icon name="gear" cls="size-4" />
        </button>
        <button
          class="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1.5 text-xs font-semibold"
          title="People in this room"
          @click="showMembers = true"
        >
          <Icon name="users" cls="size-3.5 text-white/60" />
          {{ room.members.length }}/{{ ROOM_CAPACITY }}
        </button>
      </header>

      <!-- seats -->
      <section class="px-4 py-3">
        <div v-if="room.layout === 'grid'" class="grid grid-cols-5 gap-1">
          <SeatCell
            v-for="(seat, i) in room.seats"
            :key="i"
            :seat="seat"
            :index="i"
            :role="seat ? roleOf(seat.id) : ''"
            :requested="room.myRequestSeat === i"
            :picking="pickingSeatFor !== null && !seat"
            @tap="tapSeat(i)"
          />
        </div>
        <div v-else class="flex flex-col items-center gap-3">
          <!-- host couple pod, centered on top -->
          <div class="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-500/10 via-fuchsia-500/10 to-amber-500/10 px-5 py-2">
            <SeatCell
              :seat="room.seats[0]"
              :index="0"
              :role="room.seats[0] ? roleOf(room.seats[0]!.id) : ''"
              :requested="room.myRequestSeat === 0"
              :picking="pickingSeatFor !== null && !room.seats[0]"
              @tap="tapSeat(0)"
            />
            <div class="flex flex-col items-center">
              <Icon name="heart" cls="size-4 text-fuchsia-400" />
              <span class="text-[8px] font-semibold tracking-wider text-amber-300/70">HOSTS</span>
            </div>
            <SeatCell
              :seat="room.seats[1]"
              :index="1"
              :role="room.seats[1] ? roleOf(room.seats[1]!.id) : ''"
              :requested="room.myRequestSeat === 1"
              :picking="pickingSeatFor !== null && !room.seats[1]"
              @tap="tapSeat(1)"
            />
          </div>
          <!-- 2×2 grid of couple pods -->
          <div class="grid grid-cols-2 gap-2.5">
            <div
              v-for="pair in [[2, 3], [4, 5], [6, 7], [8, 9]]"
              :key="pair[0]"
              class="flex items-center gap-2 rounded-2xl border border-fuchsia-400/15 bg-white/[0.03] px-3 py-1.5"
            >
              <SeatCell
                :seat="room.seats[pair[0]]"
                :index="pair[0]"
                :role="room.seats[pair[0]] ? roleOf(room.seats[pair[0]]!.id) : ''"
                :requested="room.myRequestSeat === pair[0]"
                :picking="pickingSeatFor !== null && !room.seats[pair[0]]"
                @tap="tapSeat(pair[0])"
              />
              <Icon name="heart" cls="size-3 shrink-0 text-fuchsia-400/60" />
              <SeatCell
                :seat="room.seats[pair[1]]"
                :index="pair[1]"
                :role="room.seats[pair[1]] ? roleOf(room.seats[pair[1]]!.id) : ''"
                :requested="room.myRequestSeat === pair[1]"
                :picking="pickingSeatFor !== null && !room.seats[pair[1]]"
                @tap="tapSeat(pair[1])"
              />
            </div>
          </div>
        </div>

        <div class="mt-1.5 flex items-center justify-between">
          <p
            class="flex items-center gap-1 text-[9px]"
            :class="room.audio === 'on' ? 'text-emerald-300/70' : 'text-white/25'"
          >
            <span
              class="size-1.5 rounded-full"
              :class="{
                'bg-emerald-400': room.audio === 'on',
                'animate-pulse bg-amber-400': room.audio === 'connecting',
                'bg-white/20': room.audio === 'off' || room.audio === 'unavailable',
              }"
            ></span>
            {{
              room.audio === "on"
                ? "Audio connected"
                : room.audio === "connecting"
                  ? "Connecting audio…"
                  : "Audio not set up yet"
            }}
          </p>
          <button
            v-if="!mySeat && room.myRequestSeat !== null"
            class="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] text-amber-300"
            @click="room.cancelRequest()"
          >
            Cancel request
          </button>
        </div>
        <p v-if="mySeat?.blocked" class="mt-1 text-[10px] text-red-300">
          A moderator muted your mic — only they can unmute you.
        </p>

        <!-- pending seat requests (staff only) -->
        <div v-if="room.isStaff && room.requests.length" class="mt-2 space-y-1.5">
          <div
            v-for="r in room.requests"
            :key="r.user.id"
            class="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-1.5 text-xs"
          >
            <Avatar :avatar="r.user.avatar" :name="r.user.nickname" :user-id="r.user.id" size-class="size-6 text-[10px]" fallback="initial" />
            <span class="min-w-0 flex-1 truncate text-white/70">{{ r.user.nickname }} wants seat {{ r.seat + 1 }}</span>
            <button class="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold text-black" @click="room.grantSeat(r.user.id)">
              Allow
            </button>
            <button class="rounded-full bg-surface-2 px-2.5 py-0.5 text-[10px] text-white/50" @click="room.denySeat(r.user.id)">
              Deny
            </button>
          </div>
        </div>
      </section>

      <!-- chat -->
      <div ref="listEl" class="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        <p v-if="!room.messages.length" class="py-6 text-center text-xs text-white/30">It's quiet in here… say hi</p>
        <template v-for="m in room.messages" :key="m.id">
          <p v-if="m.system" class="text-center text-[10px] text-white/35">{{ m.text }}</p>
          <div v-else class="flex items-start gap-2.5">
            <Avatar :avatar="m.avatar" :name="m.author" :user-id="m.userId" size-class="size-8 text-xs" fallback="initial" />
            <div class="min-w-0 flex-1">
              <p class="text-[10px]" :class="m.userId === app.user?.id ? 'text-fuchsia-300/80' : 'text-white/40'">
                {{ m.author }}
              </p>
              <div
                class="mt-1 inline-block max-w-[85%] rounded-xl rounded-tl-[4px] px-3 py-1.5 text-sm leading-snug break-words"
                :class="m.userId === app.user?.id ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'bg-surface-2'"
              >
                {{ m.text }}
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- bottom action bar -->
      <footer class="flex items-center gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <template v-if="room.iAmDisabled">
          <div class="flex-1 rounded-full bg-red-500/10 px-4 py-2.5 text-center text-sm text-red-300">
            A moderator disabled you — you can't talk or type
          </div>
        </template>
        <template v-else-if="!composing">
          <button class="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-left text-sm text-white/30" @click="openComposer">
            Say something…
          </button>
          <button class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-amber-300" title="Inventory & gifts" @click="showInventory = true">
            <Icon name="gift" cls="size-4.5" />
          </button>
          <button
            v-if="mySeat"
            class="grid size-10 shrink-0 place-items-center rounded-full"
            :class="mySeat.blocked ? 'bg-red-500/20 text-red-400' : mySeat.muted ? 'bg-white text-black' : 'bg-emerald-500/20 text-emerald-300'"
            :title="mySeat.blocked ? 'Muted by a moderator' : mySeat.muted ? 'Unmute' : 'Mute'"
            :disabled="mySeat.blocked"
            @click="room.setMuted(!mySeat.muted)"
          >
            <Icon :name="mySeat.muted || mySeat.blocked ? 'mic-off' : 'mic'" cls="size-4.5" />
          </button>
          <button v-if="mySeat" class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-white/60" title="Step down from seat" @click="room.leaveSeat()">
            <Icon name="step-down" cls="size-4.5" />
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
              class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-surface"
              @click="openCard(m)"
            >
              <Avatar :avatar="m.avatar" :name="m.nickname" :user-id="m.id" size-class="size-10 text-sm" fallback="initial" />
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
              <Icon v-if="room.seats.some((s) => s?.id === m.id)" name="seat" cls="size-3.5 text-emerald-300" />
            </button>
          </div>
        </div>
      </div>

      <!-- inventory / gifts sheet -->
      <div v-if="showInventory" class="absolute inset-0 z-20 flex flex-col justify-end bg-black/60" @click.self="showInventory = false">
        <div class="flex max-h-[60%] flex-col rounded-t-3xl border-t border-line bg-bg">
          <div class="flex items-center justify-between px-5 py-3">
            <p class="flex items-center gap-1.5 text-sm font-semibold">
              <Icon name="gift" cls="size-4 text-amber-300" /> Your items ({{ app.inventory.length }})
            </p>
            <button class="text-white/40" @click="showInventory = false">✕</button>
          </div>
          <p class="px-5 text-[10px] text-white/35">Gifting & in-room minigames arrive in a later update</p>
          <div class="grid flex-1 grid-cols-4 gap-2 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div v-for="(item, i) in app.inventory" :key="i" class="rounded-xl border border-line bg-surface p-2 text-center">
              <div class="text-2xl">{{ item.icon }}</div>
              <p class="mt-1 truncate text-[9px] text-white/50">{{ item.name }}</p>
            </div>
            <p v-if="!app.inventory.length" class="col-span-4 py-8 text-center text-xs text-white/30">Nothing yet — try the gacha ✨</p>
          </div>
        </div>
      </div>

      <!-- room menu sheet -->
      <div v-if="showMenu" class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" @click.self="showMenu = false">
        <div class="rounded-t-3xl border-t border-line bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15"></div>
          <div class="space-y-2">
            <button
              v-if="room.isHost"
              class="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm"
              @click="room.setLayout(room.layout === 'grid' ? 'couple' : 'grid'); showMenu = false"
            >
              <Icon :name="room.layout === 'grid' ? 'heart' : 'grid'" cls="size-4 text-fuchsia-300" />
              {{ room.layout === "grid" ? "Switch to couple layout" : "Switch to grid layout" }}
            </button>
            <button
              v-if="room.isHost"
              class="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm"
              @click="showMenu = false; showLock = true"
            >
              <Icon :name="room.locked ? 'lock' : 'unlock'" cls="size-4 text-amber-300" />
              {{ room.locked ? "Room is locked — manage PIN" : "Lock room with a PIN" }}
            </button>
            <button v-if="room.isHost" class="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm" @click="openBackgrounds">
              <Icon name="image" cls="size-4 text-sky-300" /> Change background
            </button>
            <button class="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm" @click="showMenu = false; minimize()">
              <Icon name="minimize" cls="size-4 text-white/60" /> Minimize (stay in room)
            </button>
            <button
              class="flex w-full items-center gap-3 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-300"
              @click="showMenu = false; confirmLeave = true"
            >
              <Icon name="logout" cls="size-4" /> Leave room
            </button>
          </div>
        </div>
      </div>

      <!-- background picker sheet (host) -->
      <div v-if="showBackgrounds" class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" @click.self="showBackgrounds = false">
        <div class="flex max-h-[70%] flex-col rounded-t-3xl border-t border-line bg-bg">
          <div class="flex items-center justify-between px-5 py-3">
            <p class="text-sm font-semibold">Room background</p>
            <button class="text-white/40" @click="showBackgrounds = false">✕</button>
          </div>
          <div class="grid flex-1 grid-cols-2 gap-2.5 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              class="grid h-24 place-items-center rounded-xl border text-xs text-white/50"
              :class="!room.background ? 'border-fuchsia-400 bg-fuchsia-500/10 text-fuchsia-300' : 'border-line bg-surface'"
              @click="room.setBackground(null)"
            >
              None
            </button>
            <button
              v-for="b in bgOptions"
              :key="b.id"
              class="relative h-24 overflow-hidden rounded-xl border"
              :class="room.background === b.src ? 'border-fuchsia-400' : 'border-line'"
              @click="room.setBackground(b.src)"
            >
              <img :src="b.src" class="size-full object-cover" alt="" />
              <span v-if="room.background === b.src" class="absolute right-1.5 bottom-1.5 rounded-full bg-fuchsia-500 px-2 py-0.5 text-[9px] font-semibold">Active</span>
            </button>
            <p v-if="!bgOptions.length" class="col-span-2 py-6 text-center text-xs text-white/30">
              No backgrounds uploaded yet.
            </p>
          </div>
        </div>
      </div>

      <!-- host lock sheet -->
      <div v-if="showLock" class="absolute inset-0 z-30 grid place-items-center bg-black/60 px-8" @click.self="showLock = false">
        <div class="w-full rounded-2xl border border-line bg-surface p-5">
          <p class="flex items-center gap-2 text-sm font-semibold">
            <Icon :name="room.locked ? 'lock' : 'unlock'" cls="size-4 text-amber-300" />
            {{ room.locked ? "Room is locked" : "Lock this room" }}
          </p>
          <template v-if="room.locked">
            <p class="mt-2 text-xs text-white/40">New joiners need the PIN. Unlock, or set a new PIN below.</p>
          </template>
          <input
            v-model="lockPin"
            maxlength="4"
            inputmode="numeric"
            placeholder="4-digit PIN"
            class="mt-3 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-amber-400/50"
          />
          <p v-if="lockError" class="mt-2 text-xs text-red-300">{{ lockError }}</p>
          <div class="mt-4 flex gap-2.5">
            <button v-if="room.locked" class="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm" @click="applyLock(false)">Unlock</button>
            <button v-else class="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm" @click="showLock = false">Cancel</button>
            <button
              class="flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 py-2.5 text-sm font-bold text-black disabled:opacity-40"
              :disabled="!/^\d{4}$/.test(lockPin)"
              @click="applyLock(true)"
            >
              {{ room.locked ? "Change PIN" : "Lock" }}
            </button>
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

      <!-- mini profile popup -->
      <div v-if="card" class="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" @click.self="card = null">
        <div class="rounded-t-3xl border-t border-line bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15"></div>
          <div class="flex items-center gap-3.5">
            <Avatar :avatar="card.avatar" :name="card.nickname" :user-id="card.id" size-class="size-14 text-2xl" fallback="initial" />
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5 font-bold">
                {{ card.nickname }}
                <span v-if="card.vip" class="rounded bg-gradient-to-r from-amber-400 to-yellow-300 px-1.5 py-px text-[10px] font-bold text-black">VIP</span>
              </p>
              <p class="text-[11px] text-white/40">
                {{ cardRole || "Listener" }}<span v-if="room.isDisabled(card.id)" class="text-red-300"> · disabled</span>
              </p>
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <button class="w-full rounded-xl bg-surface py-2.5 text-sm" @click="viewProfile(card!)">View profile</button>

            <template v-if="room.canModerate(card.id)">
              <div class="flex gap-2">
                <button v-if="!cardSeat" class="flex-1 rounded-xl bg-surface py-2.5 text-xs" @click="startInvite(card!.id)">
                  🪑 Invite to seat
                </button>
                <template v-else>
                  <button
                    class="flex-1 rounded-xl py-2.5 text-xs"
                    :class="cardSeat.blocked ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface text-red-300'"
                    @click="room.forceMute(card!.id, !cardSeat.blocked); card = null"
                  >
                    {{ cardSeat.blocked ? "Unmute mic" : "Mute mic" }}
                  </button>
                  <button class="flex-1 rounded-xl bg-surface py-2.5 text-xs" @click="room.removeFromSeat(card!.id); card = null">
                    Remove from seat
                  </button>
                </template>
              </div>
              <div class="flex gap-2">
                <button
                  class="flex-1 rounded-xl py-2.5 text-xs"
                  :class="room.isDisabled(card.id) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface text-red-300'"
                  @click="room.disableUser(card!.id, !room.isDisabled(card!.id)); card = null"
                >
                  {{ room.isDisabled(card.id) ? "Enable user" : "Disable user" }}
                </button>
                <button v-if="room.isHost" class="flex-1 rounded-xl bg-surface py-2.5 text-xs" @click="toggleAdmin(card!)">
                  {{ room.admins.includes(card.id) ? "Remove admin" : "Make admin" }}
                </button>
              </div>
              <button class="w-full rounded-xl bg-red-500/15 py-2.5 text-xs font-semibold text-red-300" @click="doKick(card!)">
                Kick from room
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- seat invite prompt -->
      <div
        v-if="room.inviteSeat !== null"
        class="absolute inset-x-3 top-3 z-30 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-surface-2/95 p-3.5 shadow-xl backdrop-blur"
      >
        <Icon name="seat" cls="size-6 shrink-0 text-emerald-300" />
        <p class="min-w-0 flex-1 text-xs text-white/80">
          The host invites you to <b>seat {{ room.inviteSeat + 1 }}</b>
        </p>
        <button class="rounded-full bg-surface px-3 py-1.5 text-xs text-white/50" @click="room.declineInvite()">Not now</button>
        <button class="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black" @click="room.acceptInvite()">Take seat</button>
      </div>

      <div v-if="toast" class="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-surface-2 px-4 py-2 text-xs shadow-lg">
        {{ toast }}
      </div>
    </template>
  </div>
</template>
