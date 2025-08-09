<script setup lang="ts">
import { useRoute, RouterLink, RouterView } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <!-- App Header -->
    <header v-if="route.name !== 'play'" class="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur">
      <div class="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
        <div>
          <h1 class="text-xl md:text-2xl font-semibold tracking-tight">StoryArc</h1>
          <p class="text-sm text-slate-400">A text-based choose your own adventure</p>
        </div>
        <nav class="flex items-center gap-2 text-sm">
          <RouterLink
            :class="[
              'px-3 py-1.5 rounded-md border',
              route.name === 'configure' ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 hover:bg-slate-800'
            ]"
            :to="{ name: 'configure' }"
          >Configure</RouterLink>
          <RouterLink
            :class="[
              'px-3 py-1.5 rounded-md border',
              route.name === 'configure-guided' ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 hover:bg-slate-800'
            ]"
            :to="{ name: 'configure-guided' }"
          >Guided</RouterLink>
          <RouterLink
            :class="[
              'px-3 py-1.5 rounded-md border',
              route.name === 'play' ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 hover:bg-slate-800'
            ]"
            :to="{ name: 'play' }"
          >Play</RouterLink>
        </nav>
      </div>
    </header>

    <!-- Routed content -->
    <RouterView />
  </div>
  
</template>

<style scoped>
</style>
