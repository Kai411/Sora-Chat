import { defineStore } from "pinia";
import type { Room as LiveKitRoom } from "livekit-client";
import { socket } from "../lib/socket";
import { useAppStore } from "./app";
import type { PublicUser, RoomInfo, RoomMsg, RoomState, Seat } from "../types";

// LiveKit connection lives at module scope (non-reactive) so audio survives
// minimizing the room; only the status string is reactive state.
let lkRoom: LiveKitRoom | null = null;
let lkAudioEls: HTMLMediaElement[] = [];

export type RoomAudioStatus = "off" | "connecting" | "on" | "unavailable";

/**
 * The active room lives in a global store so leaving the room *page* doesn't
 * leave the room itself — a dock pill (RoomDock) keeps it reachable anywhere.
 * Call features force-leave via router logic, per product rule.
 */
export const useRoomStore = defineStore("room", {
  state: () => ({
    room: null as RoomInfo | null,
    messages: [] as RoomMsg[],
    members: [] as PublicUser[],
    seats: Array(10).fill(null) as (Seat | null)[],
    hostId: 0,
    admins: [] as number[],
    requests: [] as { user: PublicUser; seat: number }[],
    inviteSeat: null as number | null, // pending seat invite for me
    unread: 0,
    viewing: false, // true while RoomView is on screen
    audio: "off" as RoomAudioStatus,
  }),
  getters: {
    myUserId(): number {
      return useAppStore().user?.id ?? -1;
    },
    isHost(): boolean {
      return this.hostId === this.myUserId;
    },
    isStaff(): boolean {
      return this.isHost || this.admins.includes(this.myUserId);
    },
    mySeatIndex(state): number {
      return state.seats.findIndex((s) => s?.id === this.myUserId);
    },
    myRequestSeat(state): number | null {
      return state.requests.find((r) => r.user.id === this.myUserId)?.seat ?? null;
    },
  },
  actions: {
    bind() {
      socket.on("room:message", ({ roomId, message }: { roomId: string; message: RoomMsg }) => {
        if (roomId !== this.room?.id) return;
        this.messages.push(message);
        if (this.messages.length > 200) this.messages.shift();
        if (!this.viewing) this.unread++;
      });
      socket.on("room:members", ({ roomId, members }: { roomId: string; members: PublicUser[] }) => {
        if (roomId === this.room?.id) this.members = members;
      });
      socket.on("room:state", (state: RoomState) => {
        if (state.roomId !== this.room?.id) return;
        this.applyState(state);
        this.syncMic();
      });
      socket.on("room:seatInvite", ({ roomId, seat }: { roomId: string; seat: number }) => {
        if (roomId === this.room?.id) this.inviteSeat = seat;
      });
    },
    /** Returns true on success, or the join error string ("pin_required" | "pin_wrong"). */
    async join(roomId: string, pin?: string): Promise<true | string> {
      if (this.room?.id === roomId) return true;
      const res = await socket.emitWithAck("room:join", { roomId, pin });
      if (!res) return "gone";
      if (res.error) return res.error;
      if (this.room) this.leave(); // switching rooms
      this.room = res.room;
      this.messages = res.messages;
      this.members = res.members;
      this.applyState(res.state);
      this.inviteSeat = res.myInviteSeat;
      this.unread = 0;
      this.connectAudio();
      return true;
    },
    applyState(state: RoomState) {
      this.seats = state.seats;
      this.hostId = state.hostId;
      this.admins = state.admins;
      this.requests = state.requests;
    },
    leave() {
      if (this.room) socket.emit("room:leave", { roomId: this.room.id });
      this.disconnectAudio();
      this.$reset();
    },
    /** Connect to the room's LiveKit session; remote audio plays via hidden elements. */
    async connectAudio() {
      if (!this.room || lkRoom) return;
      const roomId = this.room.id;
      const res = await socket.emitWithAck("livekit:token", { roomId });
      if (res?.error || !res?.token) {
        this.audio = "unavailable";
        return;
      }
      this.audio = "connecting";
      try {
        const { Room, RoomEvent } = await import("livekit-client");
        const lk = new Room();
        lkRoom = lk;
        lk.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== "audio") return;
          const el = track.attach();
          el.style.display = "none";
          document.body.appendChild(el);
          lkAudioEls.push(el);
        });
        lk.on(RoomEvent.TrackUnsubscribed, (track) => {
          for (const el of track.detach()) {
            el.remove();
            lkAudioEls = lkAudioEls.filter((x) => x !== el);
          }
        });
        lk.on(RoomEvent.Disconnected, () => {
          if (lkRoom === lk) this.disconnectAudio();
        });
        await lk.connect(res.url, res.token);
        // Room may have been left while we were connecting.
        if (this.room?.id !== roomId) {
          lk.disconnect();
          return;
        }
        this.audio = "on";
        this.syncMic();
      } catch {
        this.audio = "unavailable";
        lkRoom?.disconnect();
        lkRoom = null;
      }
    },
    /** Publish the mic only while seated & unmuted; otherwise stay listen-only. */
    async syncMic() {
      if (!lkRoom || this.audio !== "on") return;
      const seat = this.seats.find((s) => s?.id === this.myUserId);
      const enable = !!seat && !seat.muted;
      try {
        await lkRoom.localParticipant.setMicrophoneEnabled(enable);
      } catch {
        // Mic permission denied — reflect reality on the seat state.
        if (enable) this.setMuted(true);
      }
    },
    disconnectAudio() {
      const lk = lkRoom;
      lkRoom = null;
      lk?.disconnect();
      for (const el of lkAudioEls) el.remove();
      lkAudioEls = [];
      this.audio = "off";
    },
    send(text: string) {
      if (this.room) socket.emit("room:message", { roomId: this.room.id, text });
    },
    requestSeat(seat: number) {
      if (this.room) socket.emit("seat:request", { roomId: this.room.id, seat });
    },
    cancelRequest() {
      if (this.room) socket.emit("seat:cancel", { roomId: this.room.id });
    },
    grantSeat(userId: number) {
      if (this.room) socket.emit("seat:grant", { roomId: this.room.id, userId });
    },
    denySeat(userId: number) {
      if (this.room) socket.emit("seat:deny", { roomId: this.room.id, userId });
    },
    inviteToSeat(userId: number, seat: number) {
      if (this.room) socket.emit("seat:invite", { roomId: this.room.id, userId, seat });
    },
    acceptInvite() {
      if (this.room) socket.emit("seat:accept", { roomId: this.room.id });
      this.inviteSeat = null;
    },
    declineInvite() {
      if (this.room) socket.emit("seat:decline", { roomId: this.room.id });
      this.inviteSeat = null;
    },
    leaveSeat() {
      if (this.room) socket.emit("seat:leave", { roomId: this.room.id });
    },
    setMuted(muted: boolean) {
      if (this.room) socket.emit("seat:mute", { roomId: this.room.id, muted });
    },
    async setAdmin(userId: number, admin: boolean): Promise<string | null> {
      if (!this.room) return null;
      const res = await socket.emitWithAck("admin:set", { roomId: this.room.id, userId, admin });
      return res?.error ?? null;
    },
  },
});
