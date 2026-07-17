<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";

const app = useAppStore();
// "Me" points at the viewer's own profile page; falls back to /me until the
// session id is known.
const tabs = computed(() => [
  { to: "/", icon: "🏠", label: "Home", match: "/" },
  { to: "/feed", icon: "📰", label: "Feed", match: "/feed" },
  { to: "/rooms", icon: "🎪", label: "Rooms", match: "/rooms" },
  { to: "/dms", icon: "💬", label: "Chat", match: "/dms" },
  { to: app.user ? `/u/${app.user.id}` : "/me", icon: "👤", label: "Me", match: "/u/" },
]);
</script>

<template>
  <nav
    class="flex shrink-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <RouterLink
      v-for="t in tabs"
      :key="t.label"
      :to="t.to"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-white/40 transition-colors"
      :class="($route.path === t.match || (t.match !== '/' && $route.path.startsWith(t.match))) && '!text-fuchsia-400'"
    >
      <span class="text-xl leading-none">{{ t.icon }}</span>
      {{ t.label }}
    </RouterLink>
  </nav>
</template>
