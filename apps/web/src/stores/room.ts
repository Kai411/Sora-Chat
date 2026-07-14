import { defineStore } from "pinia";
import { socket } from "../lib/socket";
import type { PublicUser, RoomInfo, RoomMsg } from "../types";

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
    unread: 0,
    viewing: false, // true while RoomView is on screen
  }),
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
    },
    async join(roomId: string): Promise<boolean> {
      if (this.room?.id === roomId) return true;
      if (this.room) this.leave();
      const res = await socket.emitWithAck("room:join", { roomId });
      if (!res) return false;
      this.room = res.room;
      this.messages = res.messages;
      this.members = res.members;
      this.unread = 0;
      return true;
    },
    leave() {
      if (this.room) socket.emit("room:leave", { roomId: this.room.id });
      this.$reset();
    },
    send(text: string) {
      if (this.room) socket.emit("room:message", { roomId: this.room.id, text });
    },
  },
});
