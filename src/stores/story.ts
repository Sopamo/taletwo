 
import { computed, ref, watch, onUnmounted } from 'vue'
import { defineStore } from 'pinia'
import { useStorage, StorageSerializers } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth'
// Frontend no longer performs LLM calls; it delegates to backend REST endpoints.
// Keep other stores decoupled here.

export type StoryOption = {
  type: 'progress' | 'unexpected' | 'other'
  text: string
}

// Frontend relies on backend-provided optionIds. No local hashing needed.

export type StoryState = {
  // Legacy fields kept for compatibility but no longer primary
  text: string
  options: string[]
  summary: string
  notes: string[]
  loading: boolean
  error: string | null
  turn: number
}

export type StoryPage = {
  passage: string
  summary: string
  options?: string[] // present only when this page explicitly offers choices
  optionIds?: string[] // stable IDs aligned with options for this page index
}

// No local GeneratedPage; backend generates full pages.

// No option coercion on frontend; backend ensures shape.

export const useStoryStore = defineStore('story', () => {
  // Backend book identifier (created once and persisted)
  const bookId = useStorage<string | null>('taletwo.bookId', null)

  const text = useStorage<string>('taletwo.story.text', '')
  const options = useStorage<string[]>('taletwo.story.options', [])
  const summary = useStorage<string>('taletwo.story.summary', '')
  const notes = useStorage<string[]>('taletwo.story.notes', [])
  const loading = useStorage<boolean>('taletwo.story.loading', false)
  const error = useStorage<string | null>('taletwo.story.error', null)
  const turn = useStorage<number>('taletwo.story.turn', 0)

  // New paged flow state
  const pages = useStorage<StoryPage[]>('taletwo.story.pages', [], undefined, {
    serializer: StorageSerializers.object,
  })
  const index = useStorage<number>('taletwo.story.index', 0)
  // Thin frontend: no prefetch caches kept locally anymore

  const hasStarted = computed(() => pages.value.length > 0)
  const currentPage = computed<StoryPage | null>(() => pages.value[index.value] ?? null)
  const currentOptions = computed<string[]>(() => currentPage.value?.options ?? [])
  // choiceLabels removed; use currentOptions directly
  const canGoPrev = computed(() => index.value > 0)
  const canGoNext = computed(() => {
    const cp = currentPage.value
    if (!cp) return false
    return !(cp.options && cp.options.length)
  })

  // Backend handles branch pre-generation/caching; always allow rendering choices if present.
  const hasBranchPrefetchForCurrent = computed(() => true)

  // --- Readiness polling (backend precompute status) ---
  const nextReady = ref(false)
  const optionsReady = ref<Record<string, boolean>>({})
  let readyTimer: any = null
  let readyInFlight = false

  function stopReadyPolling() {
    if (readyTimer) {
      clearInterval(readyTimer)
      readyTimer = null
    }
  }

  async function pollReadyOnce() {
    if (readyInFlight) return
    readyInFlight = true
    try {
      const id = await ensureBook()
      const idx = index.value
      const auth = useAuthStore()
      const r = await fetch(`/api/books/${id}/story/ready?index=${encodeURIComponent(String(idx))}` , {
        headers: await auth.authHeaders(),
      })
      if (!r.ok) throw new Error('ready poll failed')
      const j = await r.json()
      const ready = j?.ready || { next: false, options: {} }
      nextReady.value = !!ready.next
      optionsReady.value = ready.options || {}
      // If we're at the tail with no choices and Next is ready, or if all options are ready for the current page, stop polling.
      const isTail = index.value === Math.max(pages.value.length - 1, 0)
      const hasChoices = (currentPage.value?.options?.length ?? 0) > 0
      const allOptsReady = hasChoices && (currentPage.value?.optionIds ?? []).every((oid) => !!optionsReady.value[oid])
      if ((isTail && !hasChoices && nextReady.value) || (hasChoices && allOptsReady)) {
        stopReadyPolling()
      }
    } catch {
      nextReady.value = false
      optionsReady.value = {}
    } finally {
      readyInFlight = false
    }
  }

  function startReadyPolling() {
    stopReadyPolling()
    // Only poll if a current page exists
    if (!currentPage.value) return
    // If we're already satisfied for this view, don't start polling
    const isTail = index.value === Math.max(pages.value.length - 1, 0)
    const hasChoices = (currentPage.value?.options?.length ?? 0) > 0
    const allOptsReady = hasChoices && (currentPage.value?.optionIds ?? []).every((oid) => !!optionsReady.value[oid])
    if ((isTail && !hasChoices && nextReady.value) || (hasChoices && allOptsReady)) return
    // Initial immediate poll, then interval
    pollReadyOnce()
    readyTimer = setInterval(pollReadyOnce, 1500)
  }

  // Re-check readiness whenever the current page index changes (e.g., user navigates)
  watch(
    () => index.value,
    () => {
      // reset readiness flags for the new index/page
      nextReady.value = false
      optionsReady.value = {}
      startReadyPolling()
    },
  )

  // Avoid background polling leaks when the store's consumer is unmounted
  onUnmounted(() => {
    stopReadyPolling()
  })

  function reset() {
    text.value = ''
    options.value = []
    summary.value = ''
    notes.value = []
    loading.value = false
    error.value = null
    turn.value = 0
    pages.value = []
    index.value = 0
    nextReady.value = false
    optionsReady.value = {}
    stopReadyPolling()
  }

  function rebuildTranscriptUpTo(idx: number) {
    const lines: string[] = []
    for (let i = 0; i <= idx && i < pages.value.length; i++) lines.push(pages.value[i].passage)
    text.value = lines.join('\n\n')
  }

  // --- Backend API helpers ---
  async function ensureBook(): Promise<string> {
    if (bookId.value) return bookId.value
    const auth = useAuthStore()
    const r = await fetch('/api/books', { method: 'POST', headers: await auth.authHeaders() })
    if (!r.ok) throw new Error('Failed to create book')
    const j = await r.json()
    if (!j?.id) throw new Error('Invalid create book response')
    bookId.value = j.id
    return j.id
  }

  async function createNewBook(): Promise<string> {
    const auth = useAuthStore()
    const r = await fetch('/api/books', { method: 'POST', headers: await auth.authHeaders() })
    if (!r.ok) throw new Error('Failed to create book')
    const j = await r.json()
    if (!j?.id) throw new Error('Invalid create book response')
    bookId.value = j.id
    return j.id
  }

  type DebugPlan = {
    curPoint: number
    curSub: number
    points: { title: string; brief: string; substeps?: string[] }[]
  } | null
  type StorySnapshot = {
    pages: StoryPage[]
    index: number
    notes: string[]
    summary: string
    turn: number
    debugPlan?: DebugPlan
  } | null
  async function fetchSnapshot(id: string): Promise<StorySnapshot> {
    const auth = useAuthStore()
    const r = await fetch(`/api/books/${id}/story`, { headers: await auth.authHeaders() })
    if (!r.ok) throw new Error('Failed to fetch story')
    const j = await r.json()
    return (j?.story ?? null) as StorySnapshot
  }

  function logDebugPlanMarkdown(dp?: DebugPlan) {
    if (!dp) return
    const lines: string[] = []
    lines.push('## Story Plan Debug')
    lines.push(`- Current Point: ${dp.curPoint}`)
    lines.push(`- Current Substep: ${dp.curSub}`)
    lines.push('')
    lines.push('### All Points')
    for (let i = 0; i < dp.points.length; i++) {
      const p = dp.points[i]
      lines.push(`- [${i}] ${p.title} — ${p.brief}`)
      const subs = Array.isArray(p.substeps) ? p.substeps : []
      for (let j = 0; j < subs.length; j++) {
        const current = i === dp.curPoint && j === dp.curSub ? ' **(current)**' : ''
        lines.push(`  - [${j}] ${subs[j]}${current}`)
      }
    }
    console.log(lines.join('\n'))
  }

  function applySnapshot(s: StorySnapshot) {
    if (!s) return
    pages.value = s.pages ?? []
    index.value = s.index ?? 0
    notes.value = s.notes ?? []
    summary.value = s.summary ?? ''
    turn.value = s.turn ?? 0
    rebuildTranscriptUpTo(index.value)
    // Debug: log plan cursor and outline as Markdown to the console
    logDebugPlanMarkdown(s.debugPlan)
    // Restart readiness polling for the new current page
    startReadyPolling()
  }

  async function startIfNeeded() {
    const id = await ensureBook()
    loading.value = true
    error.value = null
    try {
      // If a story already exists, load it instead of starting again
      const existing = await fetchSnapshot(id)
      if (existing) {
        applySnapshot(existing)
        return
      }
      const auth = useAuthStore()
      const r = await fetch(`/api/books/${id}/story/start`, { method: 'POST', headers: await auth.authHeaders() })
      if (!r.ok) throw new Error('Failed to start story')
      const j = await r.json()
      applySnapshot(j?.story ?? null)
    } catch (e: any) {
      error.value = e?.message || 'Failed to start story'
    } finally {
      loading.value = false
    }
  }

  function setBookId(id: string) {
    bookId.value = id
  }

  function setIndex(i: number) {
    const max = Math.max(pages.value.length - 1, 0)
    const next = Math.min(Math.max(0, Math.trunc(i)), max)
    if (next === index.value) return
    index.value = next
    rebuildTranscriptUpTo(index.value)
    startReadyPolling()
  }

  async function loadBook(id: string) {
    setBookId(id)
    loading.value = true
    error.value = null
    try {
      const existing = await fetchSnapshot(id)
      if (existing) {
        applySnapshot(existing)
        return
      }
      const auth = useAuthStore()
      const r = await fetch(`/api/books/${id}/story/start`, { method: 'POST', headers: await auth.authHeaders() })
      if (!r.ok) throw new Error('Failed to start story')
      const j = await r.json()
      applySnapshot(j?.story ?? null)
    } catch (e: any) {
      error.value = e?.message || 'Failed to load book'
    } finally {
      loading.value = false
    }
  }

  async function goPrev() {
    if (index.value > 0) {
      index.value -= 1
      rebuildTranscriptUpTo(index.value)
      startReadyPolling()
    }
  }

  async function goNext() {
    if (!canGoNext.value) return
    // If there are already forward pages (user was navigating back), just move forward locally
    if (index.value < pages.value.length - 1) {
      index.value += 1
      summary.value = pages.value[index.value].summary
      rebuildTranscriptUpTo(index.value)
      startReadyPolling()
      return
    }
    // At the tail: only advance if backend marked next as ready (precomputed)
    if (!nextReady.value) {
      return
    }
    const id = await ensureBook()
    loading.value = true
    error.value = null
    try {
      const auth = useAuthStore()
      const r = await fetch(`/api/books/${id}/story/next`, {
        method: 'POST',
        headers: await auth.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ index: index.value }),
      })
      if (!r.ok) throw new Error('Failed to advance story')
      const j = await r.json()
      applySnapshot(j?.story ?? null)
    } catch (e: any) {
      error.value = e?.message || 'Failed to advance story'
    } finally {
      loading.value = false
    }
  }

  async function chooseSuggestion(label: string) {
    const cp = currentPage.value
    if (!cp || !cp.options || !cp.options.length) return
    const i = cp.options.findIndex((l) => l === label)
    const optionId = cp.optionIds?.[i >= 0 ? i : 0]
    // Guard: only allow choosing when the selected option's branch is ready
    if (optionId && !optionsReady.value[optionId]) {
      return
    }
    const id = await ensureBook()
    loading.value = true
    error.value = null
    try {
      const auth = useAuthStore()
      const r = await fetch(`/api/books/${id}/story/choose`, {
        method: 'POST',
        headers: await auth.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(
          optionId
            ? { index: index.value, optionId }
            : { index: index.value, text: label },
        ),
      })
      if (!r.ok) throw new Error('Failed to apply choice')
      const j = await r.json()
      applySnapshot(j?.story ?? null)
    } catch (e: any) {
      error.value = e?.message || 'Failed to apply choice'
    } finally {
      loading.value = false
    }
  }

  return {
    // state
    bookId,
    text,
    summary,
    notes,
    loading,
    error,
    turn,
    pages,
    index,
    currentPage,
    currentOptions,
    canGoPrev,
    canGoNext,
    hasStarted,
    hasBranchPrefetchForCurrent,
    nextReady,
    optionsReady,
    // actions
    reset,
    startIfNeeded,
    goPrev,
    goNext,
    chooseSuggestion,
    ensureBook,
    createNewBook,
    setBookId,
    setIndex,
    loadBook,
  }
})
