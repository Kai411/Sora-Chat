import { createRouter, createWebHistory } from "vue-router";
import { hasStoredSession } from "./lib/supabase";
import { useRoomStore } from "./stores/room";

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
    { path: "/dms", component: () => import("./views/DmListView.vue") },
    { path: "/dms/:id", component: () => import("./views/DmChatView.vue"), meta: { tabs: false } },
    { path: "/random-chat", component: () => import("./views/RandomChatView.vue"), meta: { tabs: false } },
    { path: "/random-call", component: () => import("./views/RandomCallView.vue"), meta: { tabs: false, callFeature: true } },
    { path: "/call", component: () => import("./views/CallView.vue"), meta: { tabs: false, callFeature: true } },
  ],
});

router.beforeEach((to) => {
  if (to.path !== "/login" && !hasStoredSession()) return "/login";
  // Product rule: voice/call features can't run while docked in a room.
  if (to.meta.callFeature) {
    const room = useRoomStore();
    if (room.room) room.leave();
  }
});
