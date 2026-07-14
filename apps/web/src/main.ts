import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { supabase, hasStoredSession } from "./lib/supabase";
import { useAppStore } from "./stores/app";
import { useRoomStore } from "./stores/room";
import { useCallStore } from "./stores/call";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

const store = useAppStore();
store.bind();
useRoomStore().bind();
useCallStore().bind();

if (supabase && hasStoredSession()) {
  store.socketAuth().catch(() => {});
}

// Handles the return leg of the Google OAuth redirect (and confirm-email links).
supabase?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" && !store.user) {
    store
      .socketAuth()
      .then(() => {
        if (router.currentRoute.value.path === "/login") router.replace("/");
      })
      .catch(() => {});
  }
});

app.mount("#app");
