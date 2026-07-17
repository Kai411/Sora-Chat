import { defineStore } from "pinia";
import { socket } from "../lib/socket";
import { useAppStore } from "./app";
import type { PublicUser, RoomInfo, RoomMsg, RoomState, Seat } from "../types";

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
        this.seats = state.seats;
        this.hostId = state.hostId;
        this.admins = state.admins;
        this.requests = state.requests;
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
      this.$reset();
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
