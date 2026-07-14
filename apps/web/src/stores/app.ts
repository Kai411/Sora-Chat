import { defineStore } from "pinia";
import { socket } from "../lib/socket";
import type { GachaItem, PublicUser } from "../types";

const PROFILE_KEY = "sora:profile";

export function savedProfile(): { nickname: string; avatar: string } | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useAppStore = defineStore("app", {
  state: () => ({
    user: null as PublicUser | null,
    coins: 0,
    vip: false,
    inventory: [] as GachaItem[],
    online: [] as PublicUser[],
    connected: false,
  }),
  getters: {
    others(state): PublicUser[] {
      return state.online.filter((u) => u.nickname !== state.user?.nickname);
    },
  },
  actions: {
    bind() {
      socket.on("presence", (users: PublicUser[]) => (this.online = users));
      socket.on("connect", () => {
        this.connected = true;
        // Re-identify after a reconnect.
        if (this.user) this.hello(this.user.nickname, this.user.avatar).catch(() => {});
      });
      socket.on("disconnect", () => (this.connected = false));
    },
    async login(nickname: string, avatar: string) {
      if (!socket.connected) socket.connect();
      await this.hello(nickname, avatar);
      // Persist only after the server accepted us, so a dead backend
      // doesn't strand the router guard past the login screen.
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ nickname, avatar }));
    },
    async hello(nickname: string, avatar: string) {
      const res = await socket.timeout(8000).emitWithAck("hello", { nickname, avatar });
      this.user = res.user;
      this.coins = res.coins;
      this.vip = res.vip;
      this.inventory = res.inventory;
    },
    logout() {
      localStorage.removeItem(PROFILE_KEY);
      socket.disconnect();
      this.$reset();
    },
  },
});
