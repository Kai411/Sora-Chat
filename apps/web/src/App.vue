<script setup lang="ts">
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import { useAppStore } from "./stores/app";

const route = useRoute();
const app = useAppStore();
</script>

<template>
  <div class="mx-auto flex h-dvh max-w-md flex-col overflow-hidden bg-bg text-white shadow-2xl">
    <div
      v-if="app.user && !app.connected"
      class="bg-amber-500/20 py-1 text-center text-xs text-amber-300"
    >
      Reconnecting…
    </div>
    <router-view class="min-h-0 flex-1" />
    <TabBar v-if="route.meta.tabs !== false" />
  </div>
</template>
