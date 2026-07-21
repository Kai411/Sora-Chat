import { createRouter, createWebHistory } from "vue-router";
import { hasStoredSession } from "./lib/supabase";
import { useRoomStore } from "./stores/room";
import { useAppStore } from "./stores/app";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("./views/LoginView.vue"), meta: { tabs: false } },
    { path: "/", component: () => import("./views/HomeView.vue") },
    { path: "/feed", component: () => import("./views/FeedView.vue") },
    { path: "/rooms", component: () => import("./views/RoomsView.vue") },
    { path: "/rooms/:id", component: () => import("./views/RoomView.vue"), meta: { tabs: false } },
    { path: "/gacha", component: () => import("./views/GachaView.vue") },
    { path: "/gacha/:id", component: () => import("./views/GachaBannerView.vue"), meta: { tabs: false } },
    { path: "/me", redirect: () => { const a = useAppStore(); return a.user ? `/u/${a.user.id}` : "/"; } },
    { path: "/u/:id", component: () => import("./views/UserProfileView.vue") },
    { path: "/u/:id/follows", component: () => import("./views/FollowsView.vue"), meta: { tabs: false } },
    { path: "/shop", component: () => import("./views/ShopView.vue"), meta: { tabs: false } },
    { path: "/settings", component: () => import("./views/SettingsView.vue"), meta: { tabs: false } },
    { path: "/visits", component: () => import("./views/VisitsView.vue"), meta: { tabs: false } },
    { path: "/notifications", component: () => import("./views/NotificationsView.vue"), meta: { tabs: false } },
    { path: "/admin", component: () => import("./views/AdminView.vue"), meta: { tabs: false, public: true } },
    { path: "/post/:id", component: () => import("./views/PostView.vue"), meta: { tabs: false } },
    { path: "/dms", component: () => import("./views/DmListView.vue") },
    { path: "/dms/:id", component: () => import("./views/DmChatView.vue"), meta: { tabs: false } },
    { path: "/random-chat", component: () => import("./views/RandomChatView.vue"), meta: { tabs: false } },
    { path: "/random-call", component: () => import("./views/RandomCallView.vue"), meta: { tabs: false, callFeature: true } },
    { path: "/call", component: () => import("./views/CallView.vue"), meta: { tabs: false, callFeature: true } },
  ],
});

router.beforeEach((to) => {
  if (to.meta.public) return true; // admin panel has its own auth
  if (to.path !== "/login" && !hasStoredSession()) return "/login";
  // Random call is unavailable while in a party room (stay where you are).
  if (to.path === "/random-call" && useRoomStore().room) return false;
  // DM calls force-leave a docked room.
  if (to.meta.callFeature) {
    const room = useRoomStore();
    if (room.room) room.leave();
  }
});
