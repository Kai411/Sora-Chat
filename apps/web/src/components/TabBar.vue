<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
import Icon from "./Icon.vue";

const app = useAppStore();
// "Me" points at the viewer's own profile page; falls back to /me until the
// session id is known.
const tabs = computed(() => [
  { to: "/", icon: "home", label: "Home", match: "/" },
  { to: "/feed", icon: "feed", label: "Feed", match: "/feed" },
  { to: "/rooms", icon: "rooms", label: "Rooms", match: "/rooms" },
  { to: "/dms", icon: "chat", label: "Chat", match: "/dms" },
  { to: app.user ? `/u/${app.user.id}` : "/me", icon: "profile", label: "Me", match: "/u/" },
] as const);
</script>

<template>
  <nav
    class="flex shrink-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <RouterLink
      v-for="t in tabs"
      :key="t.label"
      :to="t.to"
      class="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] text-white/40 transition-colors"
      :class="($route.path === t.match || (t.match !== '/' && $route.path.startsWith(t.match))) && '!text-fuchsia-400'"
    >
      <Icon :name="t.icon" cls="size-5" />
      {{ t.label }}
    </RouterLink>
  </nav>
</template>
