<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStoryPlanStore } from '@/stores/storyPlan'
import { useStoryStore } from '@/stores/story'

const router = useRouter()
const plan = useStoryPlanStore()
const story = useStoryStore()
const busy = ref(false)
const err = ref<string | null>(null)

async function proceed() {
  busy.value = true
  err.value = null
  try {
    await plan.ensureReady()
    if (plan.isReady()) {
      // Generate the first page while still on the loading screen
      await story.startIfNeeded()
      router.replace({ name: 'play' })
    } else {
      throw new Error('Plan could not be prepared')
    }
  } catch (e: any) {
    err.value = e?.message || 'Failed to prepare plan'
  } finally {
    busy.value = false
  }
}

function regenerate() {
  plan.resetAll()
  proceed()
}

onMounted(() => {
  // Immediately try to ensure the plan is ready
  proceed()
})
</script>

<template>
  <div class="mx-auto max-w-md w-full px-4 py-10 text-center space-y-4">
    <h1 class="text-2xl font-semibold">Preparing your story plan…</h1>
    <p class="text-slate-400">We’re outlining key story points and sub-steps to guide a cohesive narrative.</p>

    <div v-if="err" class="text-rose-400">{{ err }}</div>

    <div class="flex items-center justify-center gap-2" v-if="busy && !err">
      <svg class="animate-spin h-5 w-5 text-slate-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span class="text-slate-300">Thinking…</span>
    </div>

    <div class="flex items-center justify-center gap-3" v-else>
      <button @click="proceed" class="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800">Try again</button>
      <button @click="regenerate" class="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800">Regenerate plan</button>
    </div>
  </div>
</template>

<style scoped></style>
