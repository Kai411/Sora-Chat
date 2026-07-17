<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useRoomStore } from "../stores/room";
import type { PublicUser } from "../types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const room = useRoomStore();
const roomId = String(route.params.id);

const draft = ref("");
const listEl = ref<HTMLElement | null>(null);
const gone = ref(false);
const needPin = ref(false);
const pinDraft = ref("");
const pinError = ref("");
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

function send() {
  const text = draft.value.trim();
  if (!text) return;
  room.send(text);
  draft.value = "";
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

function badge(userId: number) {
  if (userId === room.hostId) return "👑";
  if (room.admins.includes(userId)) return "🛡️";
  return "";
}

function openMemberMenu(m: PublicUser) {
  if (!room.isStaff || m.id === app.user?.id) return;
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
      <header class="border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div class="flex items-center gap-3">
          <button class="text-white/50" title="Minimize — you stay in the room" @click="minimize">⌄</button>
          <span class="text-2xl">{{ room.room?.icon }}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">
              <span v-if="room.room?.locked">🔒</span> {{ room.room?.name ?? "…" }}
            </p>
            <p class="text-[10px] text-white/40">
              {{ CATEGORY_LABEL[room.room?.category ?? "chat"] }} · {{ room.members.length }} here
            </p>
          </div>
          <button class="rounded-full bg-surface-2 px-3 py-1.5 text-xs text-red-300" @click="leave">Leave</button>
        </div>
      </header>

      <!-- seats: 2 rows × 5 columns -->
      <section class="border-b border-line px-4 py-3">
        <div class="grid grid-cols-5 gap-2">
          <button
            v-for="(seat, i) in room.seats"
            :key="i"
            class="flex flex-col items-center gap-0.5 rounded-xl border py-2 transition-transform active:scale-95"
            :class="[
              seat ? 'border-line bg-surface' : 'border-dashed border-white/15 bg-transparent',
              pickingSeatFor !== null && !seat && 'border-emerald-400/60',
              room.myRequestSeat === i && 'border-amber-400/60',
            ]"
            @click="tapSeat(i)"
          >
            <template v-if="seat">
              <span class="relative text-xl leading-none">
                {{ seat.avatar }}
                <span v-if="badge(seat.id)" class="absolute -top-1.5 -right-2 text-[9px]">{{ badge(seat.id) }}</span>
              </span>
              <span class="w-full truncate px-0.5 text-center text-[8px] text-white/50">{{ seat.nickname }}</span>
              <span class="text-[9px]">{{ seat.muted ? "🔇" : "🎙️" }}</span>
            </template>
            <template v-else>
              <span class="text-lg text-white/25">＋</span>
              <span class="text-[8px] text-white/25">{{ room.myRequestSeat === i ? "asked" : `seat ${i + 1}` }}</span>
            </template>
          </button>
        </div>
        <div class="mt-2 flex items-center justify-between">
          <p class="text-[9px] text-white/25">🎙️ live audio arrives with LiveKit (phase 2)</p>
          <div v-if="mySeat" class="flex gap-2">
            <button
              class="rounded-full px-2.5 py-1 text-[10px]"
              :class="mySeat.muted ? 'bg-white text-black' : 'bg-surface-2'"
              @click="room.setMuted(!mySeat.muted)"
            >
              {{ mySeat.muted ? "🔇 Unmute" : "🎙️ Mute" }}
            </button>
            <button class="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] text-red-300" @click="room.leaveSeat()">
              Step down
            </button>
          </div>
          <button
            v-else-if="room.myRequestSeat !== null"
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
            <span>{{ r.user.avatar }}</span>
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

        <!-- members strip -->
        <div class="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">
          <button
            v-for="m in room.members"
            :key="m.id"
            class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs"
            @click="openMemberMenu(m)"
          >
            {{ m.avatar }} {{ m.nickname }} {{ badge(m.id) }}
          </button>
        </div>
      </section>

      <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <p v-if="!room.messages.length" class="py-6 text-center text-xs text-white/30">
          It's quiet in here… say hi 👋
        </p>
        <div
          v-for="m in room.messages"
          :key="m.id"
          class="flex gap-2.5"
          :class="m.userId === app.user?.id && 'flex-row-reverse'"
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-base">{{ m.avatar }}</span>
          <div class="max-w-[75%]" :class="m.userId === app.user?.id && 'text-right'">
            <p class="text-[10px] text-white/40">{{ m.author }}</p>
            <div
              class="mt-0.5 inline-block rounded-2xl px-3.5 py-2 text-left text-sm"
              :class="m.userId === app.user?.id ? 'rounded-tr-sm bg-gradient-to-r from-violet-500 to-fuchsia-500' : 'rounded-tl-sm bg-surface-2'"
            >
              {{ m.text }}
            </div>
          </div>
        </div>
      </div>

      <footer class="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input
          v-model="draft"
          placeholder="Message the room…"
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

      <!-- staff member menu -->
      <div
        v-if="memberMenu"
        class="absolute inset-0 z-20 flex flex-col justify-end bg-black/60"
        @click.self="memberMenu = null"
      >
        <div class="rounded-t-3xl border-t border-line bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <p class="text-center text-sm font-semibold">{{ memberMenu.avatar }} {{ memberMenu.nickname }}</p>
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
