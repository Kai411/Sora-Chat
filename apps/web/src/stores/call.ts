import { defineStore } from "pinia";
import { socket } from "../lib/socket";
import type { PublicUser } from "../types";

type CallStatus = "idle" | "ringing" | "active" | "declined" | "ended";

/**
 * DM (direct) call signaling state. The incoming-call overlay and CallView
 * both read from here; WebRTC setup itself happens in CallView via lib/webrtc.
 */
export const useCallStore = defineStore("call", {
  state: () => ({
    status: "idle" as CallStatus,
    sessionId: "",
    role: "caller" as "caller" | "callee",
    peer: null as PublicUser | null,
    incoming: null as { sessionId: string; from: PublicUser } | null,
  }),
  actions: {
    bind() {
      socket.on("dm:call:incoming", (payload: { sessionId: string; from: PublicUser }) => {
        // Busy on another call: auto-decline so the caller isn't left hanging.
        if (this.status === "ringing" || this.status === "active") {
          socket.emit("dm:call:decline", { sessionId: payload.sessionId });
          return;
        }
        this.incoming = payload;
      });
      socket.on("dm:call:cancelled", ({ sessionId }: { sessionId: string }) => {
        if (this.incoming?.sessionId === sessionId) this.incoming = null;
      });
      socket.on("dm:call:start", ({ sessionId, role, peer }: any) => {
        if (sessionId === this.sessionId) {
          this.role = role;
          this.peer = peer;
          this.status = "active";
        }
      });
      socket.on("dm:call:declined", ({ sessionId }: { sessionId: string }) => {
        if (sessionId === this.sessionId) this.status = "declined";
      });
    },
    async invite(user: PublicUser): Promise<string | null> {
      const res = await socket.emitWithAck("dm:call:invite", { userId: user.id });
      if (res?.error) throw new Error(res.error);
      this.sessionId = res.sessionId;
      this.peer = res.peer;
      this.role = "caller";
      this.status = "ringing";
      return res.sessionId;
    },
    async accept(): Promise<boolean> {
      if (!this.incoming) return false;
      const res = await socket.emitWithAck("dm:call:accept", { sessionId: this.incoming.sessionId });
      this.incoming = null;
      if (res?.error) return false;
      this.sessionId = res.sessionId;
      this.role = res.role;
      this.peer = res.peer;
      this.status = "active";
      return true;
    },
    decline() {
      if (this.incoming) socket.emit("dm:call:decline", { sessionId: this.incoming.sessionId });
      this.incoming = null;
    },
    hangup() {
      if (this.sessionId && (this.status === "ringing" || this.status === "active")) {
        socket.emit("session:leave", { sessionId: this.sessionId });
      }
      this.status = "ended";
    },
    reset() {
      this.status = "idle";
      this.sessionId = "";
      this.peer = null;
    },
  },
});
