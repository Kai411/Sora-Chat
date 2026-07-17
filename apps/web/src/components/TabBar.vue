<script setup lang="ts">
const tabs = [
  { to: "/", icon: "🏠", label: "Home" },
  { to: "/feed", icon: "📰", label: "Feed" },
  { to: "/rooms", icon: "🎪", label: "Rooms" },
  { to: "/dms", icon: "💬", label: "Chat" },
  { to: "/me", icon: "👤", label: "Me" },
];
</script>

<template>
  <nav
    class="flex shrink-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <RouterLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-white/40 transition-colors"
      exact-active-class="!text-fuchsia-400"
    >
      <span class="text-xl leading-none">{{ t.icon }}</span>
      {{ t.label }}
    </RouterLink>
  </nav>
</template>
