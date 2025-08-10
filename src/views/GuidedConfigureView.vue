<script setup lang="ts">
import { onMounted, ref, computed, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import ChoicesList from '@/components/ChoicesList.vue'
import UserInput from '@/components/UserInput.vue'
import { useStoryConfigStore } from '@/stores/storyConfig'
import { useStoryStore } from '@/stores/story'
import { useAuthStore } from '@/stores/auth'

// Steps for guided configuration
const steps = [
  {
    id: 'books',
    label: 'Stories to blend',
    hint: 'Enter the name of two stories you love and want to blend together.',
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
  { id: 'genre', label: 'Genre', hint: 'E.g. fantasy, sci-fi, mystery, etc.' },
] as const

type StepId = (typeof steps)[number]['id']

const router = useRouter()
const cfg = useStoryConfigStore()
const story = useStoryStore()
const auth = useAuthStore()

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
    cfg.reset()
  } catch {}

  // Abort any in-flight suggestions and reset guided state
  controller?.abort()
  controller = null
  idx.value = 0
  options.value = []
  question.value = ''
  error.value = null
  // Create a brand-new book on backend and start fresh suggestions
  story
    .createNewBook()
    .then(() => fetchSuggestions())
    .catch((e: any) => (error.value = e?.message || 'Failed to start new book'))
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
  // Ensure a book exists on backend for context-aware suggestions
  const id = await story.ensureBook()

  try {
    const r = await fetch(`/api/books/${id}/config?s=${encodeURIComponent(step.id)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: await auth.authHeaders(),
    })
    if (!r.ok) throw new Error('Failed to fetch suggestions')
    const data = await r.json()
    const q = (data?.question ?? '').toString()
    const opts = Array.isArray(data?.options)
      ? data.options.map((x: any) => String(x)).slice(0, 3)
      : []
    if (!q || opts.length !== 3) throw new Error('Invalid suggestion response')
    question.value = q
    options.value = opts
  } catch (e: any) {
    error.value = e?.message || 'Failed to fetch suggestions'
  } finally {
    loading.value = false
  }
}

async function onChoose(s: string) {
  await saveValue(currentStep.value.id, s)
  next()
}

async function onSubmitFreeform(s: string) {
  await saveValue(currentStep.value.id, s)
  next()
}

async function saveValue(stepId: StepId, value: string) {
  // Persist to backend and update local store
  const id = await story.ensureBook()
  const body = { setting: stepId, value } as any
  const r = await fetch(`/api/books/${id}/config`, {
    method: 'POST',
    headers: await auth.authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error('Failed to save config')
  // Update local cache after backend accepts it
  commitValue(stepId, value)
}

function next() {
  if (!isLast.value) {
    idx.value += 1
    fetchSuggestions()
  } else {
    // Completed all steps — always show loading view while backend starts the story
    // Router guard already prevents entering 'play' if config is incomplete.
    router.push({ name: 'plan-loading' })
  }
}

function back() {
  if (idx.value > 0) {
    idx.value -= 1
    fetchSuggestions()
  }
}

onMounted(fetchSuggestions)
</script>

<template>
  <div class="mx-auto max-w-3xl w-full px-4 py-6 space-y-6">
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
