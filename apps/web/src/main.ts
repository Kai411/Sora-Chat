import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { socket } from "./lib/socket";
import { useAppStore, savedToken } from "./stores/app";
import { useRoomStore } from "./stores/room";
import { useCallStore } from "./stores/call";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

useAppStore().bind();
useRoomStore().bind();
useCallStore().bind();

if (savedToken()) {
  socket.connect();
  useAppStore()
    .resume()
    .catch(() => {
      if (!savedToken()) router.replace("/login");
    });
}

app.mount("#app");
