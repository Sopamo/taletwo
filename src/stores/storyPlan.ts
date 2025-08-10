import { defineStore } from 'pinia'
import { ref } from 'vue'

// Minimal no-op story plan store to keep legacy imports compiling.
// All planning now happens in the backend.

export type StoryPoint = { title: string; brief: string; substeps?: string[] }
export type StoryPlan = { overallIdea: string; conflict: string; points: StoryPoint[] }

export const useStoryPlanStore = defineStore('storyPlan', () => {
  const plan = ref<StoryPlan | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const curPoint = ref(0)
  const curSub = ref(0)

  function resetAll() {
    plan.value = null
    loading.value = false
    error.value = null
    curPoint.value = 0
    curSub.value = 0
  }

  const isReady = () => true
  async function ensureReady() {}
  async function generatePlan() {}
  async function expandSubstepsBatch() {}
  async function expandAllSubsteps() {}
  function getNextSubstep(): { pointIndex: number; subIndex: number; text: string } | null { return null }
  function markSubstepDone() {}

  return {
    plan,
    loading,
    error,
    curPoint,
    curSub,
    resetAll,
    isReady,
    ensureReady,
    generatePlan,
    expandSubstepsBatch,
    expandAllSubsteps,
    getNextSubstep,
    markSubstepDone,
  }
})
