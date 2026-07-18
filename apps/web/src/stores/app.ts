import { defineStore } from "pinia";
import { socket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import type { GachaItem, PublicUser } from "../types";

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
        if (this.user) this.socketAuth().catch(() => {});
      });
      socket.on("disconnect", () => (this.connected = false));
    },
    /**
     * Exchange the current Supabase session for a socket identity: the server
     * verifies the access token with Supabase and returns the Sora profile.
     */
    async socketAuth(extra?: { nickname?: string; avatar?: string }) {
      if (!supabase) throw new Error("Supabase isn't configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Not signed in");
      if (!socket.connected) socket.connect();
      const res = await socket
        .timeout(10000)
        .emitWithAck("auth:supabase", { accessToken: data.session.access_token, ...extra })
        .catch(() => {
          throw new Error("Can't reach the server. Please try again in a moment.");
        });
      if (res?.error) throw new Error(res.error);
      this.user = res.user;
      this.coins = res.coins;
      this.vip = res.vip;
      this.inventory = res.inventory;
    },
    /** Returns "confirm" when Supabase requires email confirmation first. */
    async signUp(input: { email: string; password: string; nickname: string }) {
      if (!supabase) throw new Error("Supabase isn't configured");
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { nickname: input.nickname } },
      });
      if (error) throw new Error(error.message);
      if (!data.session) return "confirm" as const;
      await this.socketAuth({ nickname: input.nickname });
      return "ok" as const;
    },
    async signIn(input: { email: string; password: string }) {
      if (!supabase) throw new Error("Supabase isn't configured");
      const { error } = await supabase.auth.signInWithPassword(input);
      if (error) throw new Error(error.message);
      await this.socketAuth();
    },
    /** Redirects to Google; the session comes back via onAuthStateChange. */
    async signInGoogle() {
      if (!supabase) throw new Error("Supabase isn't configured");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw new Error(error.message);
    },
    async resetPassword(email: string) {
      if (!supabase) throw new Error("Supabase isn't configured");
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw new Error(error.message);
    },
    async rename(name: string): Promise<string | null> {
      const res = await socket.emitWithAck("user:rename", { name });
      if (res?.error) return res.error;
      if (this.user) this.user.nickname = res.nickname;
      return null;
    },
    async logout() {
      await supabase?.auth.signOut().catch(() => {});
      socket.disconnect();
      this.$reset();
    },
  },
});
