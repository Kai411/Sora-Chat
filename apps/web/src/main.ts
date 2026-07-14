import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useAppStore, savedProfile } from "./stores/app";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

const store = useAppStore();
store.bind();

const profile = savedProfile();
if (profile) store.login(profile.nickname, profile.avatar);

app.mount("#app");
