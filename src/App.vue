<script setup lang="ts">
import { useRoute, RouterLink, RouterView } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <!-- App Header -->
    <header
      v-if="route.name !== 'play'"
      class="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur"
    >
      <div class="mx-auto max-w-3xl px-4 py-4">
        <div class="text-center">
          <h1 class="text-xl md:text-2xl font-semibold tracking-tight">TaleTwo</h1>
          <p class="text-sm text-slate-400">
            A text-based choose your own adventure, based on your favorite stories.
          </p>
        </div>
      </div>
    </header>

    <!-- Routed content -->
    <RouterView />
  </div>
</template>

<style scoped></style>
