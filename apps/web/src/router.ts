import { createRouter, createWebHistory } from "vue-router";
import { savedProfile } from "./stores/app";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("./views/LoginView.vue"), meta: { tabs: false } },
    { path: "/", component: () => import("./views/HomeView.vue") },
    { path: "/feed", component: () => import("./views/FeedView.vue") },
    { path: "/rooms", component: () => import("./views/RoomsView.vue") },
    { path: "/rooms/:id", component: () => import("./views/RoomView.vue"), meta: { tabs: false } },
    { path: "/gacha", component: () => import("./views/GachaView.vue") },
    { path: "/me", component: () => import("./views/ProfileView.vue") },
    { path: "/random-chat", component: () => import("./views/RandomChatView.vue"), meta: { tabs: false } },
    { path: "/random-call", component: () => import("./views/RandomCallView.vue"), meta: { tabs: false } },
  ],
});

router.beforeEach((to) => {
  if (to.path !== "/login" && !savedProfile()) return "/login";
  if (to.path === "/login" && savedProfile()) return "/";
});
