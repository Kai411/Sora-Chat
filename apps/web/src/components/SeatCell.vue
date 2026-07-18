<script setup lang="ts">
import Avatar from "./Avatar.vue";
import Icon from "./Icon.vue";
import { useRoomStore } from "../stores/room";
import type { Seat } from "../types";

const props = defineProps<{
  seat: Seat | null;
  index: number;
  role: "" | "Host" | "Admin";
  requested: boolean; // I asked for this seat
  picking: boolean; // staff is choosing a seat to invite someone to
}>();
const emit = defineEmits<{ tap: [] }>();

const room = useRoomStore();
const speaking = () => !!props.seat && room.speaking.includes(props.seat.id);
</script>

<template>
  <button
    class="flex flex-col items-center gap-4 py-1 transition-transform active:scale-95"
    @click="emit('tap')"
  >
    <template v-if="seat">
      <Avatar
        :avatar="seat.avatar"
        :name="seat.nickname"
        :user-id="seat.id"
        :frame="seat.frame"
        :frame-fit="2"
        :class="speaking() && 'anim-speak'"
        size-class="size-14 text-lg"
        fallback="initial"
      />
      <span
        class="flex h-3 items-center gap-1 text-[9px] font-semibold"
        :class="
          role === 'Host'
            ? 'text-amber-300'
            : role === 'Admin'
              ? 'text-sky-300'
              : 'text-white/40'
        "
      >
        {{ role || index + 1 }}
        <Icon
          :name="seat.blocked || seat.muted ? 'mic-off' : 'mic'"
          cls="size-2.5"
          :class="
            seat.blocked
              ? 'text-red-500'
              : seat.muted
                ? 'text-white/40'
                : 'text-emerald-400'
          "
        />
      </span>
    </template>
    <template v-else>
      <span
        class="grid size-14 place-items-center rounded-full border border-dashed text-white/25"
        :class="
          picking
            ? 'border-emerald-400/70 text-emerald-300'
            : requested
              ? 'border-amber-400/70 text-amber-300'
              : 'border-white/15'
        "
      >
        <Icon name="plus" cls="size-4" />
      </span>
      <span
        class="h-3 text-[9px]"
        :class="requested ? 'text-amber-300' : 'text-white/25'"
      >
        {{ requested ? "asked" : index + 1 }}
      </span>
    </template>
  </button>
</template>
