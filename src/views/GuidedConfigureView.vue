<script setup lang="ts">
import { onMounted, ref, computed, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import ChoicesList from '@/components/ChoicesList.vue'
import UserInput from '@/components/UserInput.vue'
import { chat, type ChatMessage } from '@/lib/llm'
import { useStoryConfigStore } from '@/stores/storyConfig'
import { useStoryPlanStore } from '@/stores/storyPlan'
import { useStoryStore } from '@/stores/story'

// Steps for guided configuration
const steps = [
  {
    id: 'books',
    label: 'Books',
    hint: 'Enter exactly two books you love and want to blend (comma-separated).',
  },
  {
    id: 'world',
    label: 'World',
    hint: 'One or two sentences describing the setting, era, vibe, conflicts.',
  },
  {
    id: 'mainCharacter',
    label: 'Main Character',
    hint: 'Who is the protagonist? A name and a word or two describing them is fine.',
  },
  { id: 'genre', label: 'Genre', hint: 'One short genre, e.g. fantasy, sci-fi, mystery, etc.' },
] as const

type StepId = (typeof steps)[number]['id']

const router = useRouter()
const cfg = useStoryConfigStore()
const plan = useStoryPlanStore()
const story = useStoryStore()

const idx = ref(0)
const question = ref('')
const options = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null

const currentStep = computed(() => steps[idx.value])
const isLast = computed(() => idx.value === steps.length - 1)

function snapshotConfig() {
  return {
    books: cfg.books?.length ? cfg.books : undefined,
    world: cfg.world || undefined,
    mainCharacter: cfg.mainCharacter || undefined,
    genre: cfg.genre || undefined,
  }
}

function startNewBook() {
  // Clear current story, plan, and configuration
  try {
    story.reset()
  } catch {}
  try {
    plan.resetAll()
  } catch {}
  try {
    cfg.reset()
  } catch {}

  // Abort any in-flight suggestions and reset guided state
  controller?.abort()
  controller = null
  idx.value = 0
  options.value = []
  question.value = ''
  error.value = null
  fetchSuggestions()
}

function csvToArray(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function commitValue(stepId: StepId, value: string) {
  if (stepId === 'books') cfg.books = csvToArray(value)
  else if (stepId === 'world') cfg.world = value
  else if (stepId === 'mainCharacter') cfg.mainCharacter = value
  else if (stepId === 'genre') cfg.genre = value
}

async function fetchSuggestions() {
  loading.value = true
  error.value = null
  options.value = []
  question.value = ''

  controller?.abort()
  controller = new AbortController()

  const step = currentStep.value
  const context = snapshotConfig()

  const sys: ChatMessage = {
    role: 'system',
    content:
      'You are helping a user configure a choose-your-own-adventure story. For the requested field, return a JSON object with fields: {"question": string, "options": [string, string, string]}. The question should politely ask the user for that field, and each option should be short, vivid, and distinct. Respond STRICTLY with JSON and nothing else.',
  }

  const usr: ChatMessage = {
    role: 'user',
    content: `Current config (may be partial):\n${JSON.stringify(context)}\n\nField to suggest: ${step.label}\nHint: ${step.hint}\nReturn exactly three options in JSON as described.`,
  }

  try {
    const res = await chat([sys, usr], {
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      signal: controller.signal,
    })

    let data: any
    try {
      data = JSON.parse(res.content)
    } catch (e) {
      throw new Error('Model did not return valid JSON. Content: ' + res.content?.slice(0, 200))
    }

    const q = (data?.question ?? '').toString()
    const opts = Array.isArray(data?.options)
      ? data.options.map((x: any) => String(x)).slice(0, 3)
      : []
    if (!q || opts.length !== 3)
      throw new Error('Missing question or exactly three options in response')

    question.value = q
    options.value = opts
  } catch (e: any) {
    error.value = e?.message || 'Failed to fetch suggestions'
  } finally {
    loading.value = false
  }
}

function onChoose(s: string) {
  commitValue(currentStep.value.id, s)
  next()
}

function onSubmitFreeform(s: string) {
  commitValue(currentStep.value.id, s)
  next()
}

function next() {
  if (!isLast.value) {
    idx.value += 1
    fetchSuggestions()
  } else {
    // Completed all steps — go to plan-loading to prepare the story plan before play
    if (cfg.isComplete) router.push({ name: 'plan-loading' })
    else router.push({ name: 'configure-guided' })
  }
}

function back() {
  if (idx.value > 0) {
    idx.value -= 1
    fetchSuggestions()
  }
}

onMounted(fetchSuggestions)

watchEffect(() => {
  // if current step's value already filled (coming back), prefill options again using config
  // We rely on LLM to adjust based on context.
})
</script>

<template>
  <div class="mx-auto max-w-3xl w-full px-4 py-6 space-y-6">
    <div v-if="cfg.isComplete || story.hasStarted" class="rounded-md border border-amber-600/30 bg-amber-950/30 p-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-semibold">Current setup</h3>
          <p class="text-xs text-amber-300/90">Starting a new book will override the current one.</p>
        </div>
        <button
          @click="startNewBook"
          class="px-3 py-1.5 text-sm rounded-md bg-amber-600 hover:bg-amber-500 text-black font-medium"
        >
          Start new book
        </button>
      </div>
      <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-300">
        <div><span class="text-slate-400">Books:</span> {{ (cfg.books || []).join(', ') || '—' }}</div>
        <div><span class="text-slate-400">World:</span> {{ cfg.world || '—' }}</div>
        <div><span class="text-slate-400">Main character:</span> {{ cfg.mainCharacter || '—' }}</div>
        <div><span class="text-slate-400">Genre:</span> {{ cfg.genre || '—' }}</div>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-semibold tracking-tight">Guided setup</h2>
        <p class="text-sm text-slate-400">
          Step {{ idx + 1 }} of {{ steps.length }} — {{ currentStep.label }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="back"
          :disabled="idx === 0 || loading"
          class="px-3 py-1.5 text-sm rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50"
        >
          Back
        </button>
      </div>
    </div>

    <div class="space-y-3">
      <p v-if="question" class="text-base md:text-lg">{{ question }}</p>
      <p v-else-if="loading" class="text-slate-400">Thinking…</p>
      <p v-else-if="error" class="text-rose-400">{{ error }}</p>
    </div>

    <ChoicesList
      v-if="options.length"
      :title="'Suggestions'"
      :choices="options"
      :disabled="loading"
      @select="onChoose"
    />

    <div class="pt-2">
      <UserInput
        :placeholder="'Or type your own for ' + currentStep.label.toLowerCase() + '…'"
        @submit="onSubmitFreeform"
      />
      <p class="text-xs text-slate-500 mt-1">Hint: {{ currentStep.hint }}</p>
    </div>
  </div>
</template>

<style scoped></style>
