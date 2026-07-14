import { defineStore } from "pinia";
import { socket } from "../lib/socket";
import type { GachaItem, PublicUser } from "../types";

const TOKEN_KEY = "sora:token";

export function savedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

interface AuthResponse {
  error?: string;
  token?: string | null;
  user: PublicUser;
  coins: number;
  vip: boolean;
  inventory: GachaItem[];
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
      return state.online.filter((u) => u.id !== state.user?.id);
    },
  },
  actions: {
    bind() {
      socket.on("presence", (users: PublicUser[]) => (this.online = users));
      socket.on("connect", () => {
        this.connected = true;
        // Re-identify after a reconnect.
        if (this.user && savedToken()) this.resume().catch(() => {});
      });
      socket.on("disconnect", () => (this.connected = false));
    },
    applyAuth(res: AuthResponse) {
      if (res.error) throw new Error(res.error);
      this.user = res.user;
      this.coins = res.coins;
      this.vip = res.vip;
      this.inventory = res.inventory;
      if (res.token) localStorage.setItem(TOKEN_KEY, res.token);
    },
    async authCall(event: string, payload: object) {
      if (!socket.connected) socket.connect();
      const res = await socket.timeout(10000).emitWithAck(event, payload).catch(() => {
        throw new Error("Can't reach the server. Please try again in a moment.");
      });
      this.applyAuth(res);
    },
    register(data: { email: string; password: string; nickname: string; avatar: string }) {
      return this.authCall("auth:register", data);
    },
    login(data: { email: string; password: string }) {
      return this.authCall("auth:login", data);
    },
    loginGoogle(idToken: string) {
      return this.authCall("auth:google", { idToken });
    },
    async resume() {
      const token = savedToken();
      if (!token) throw new Error("no token");
      try {
        await this.authCall("auth:resume", { token });
      } catch (e: any) {
        // Expired/invalid session (but not a network hiccup): clear the token.
        if (!String(e?.message).startsWith("Can't reach")) localStorage.removeItem(TOKEN_KEY);
        throw e;
      }
    },
    logout() {
      const token = savedToken();
      if (token) socket.emit("auth:logout", { token });
      localStorage.removeItem(TOKEN_KEY);
      socket.disconnect();
      this.$reset();
    },
  },
});
