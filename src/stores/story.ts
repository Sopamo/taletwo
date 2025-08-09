import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage, StorageSerializers } from '@vueuse/core'
import { chat, buildSystemPromptFromConfig, type ChatMessage } from '@/lib/llm'
import { useStoryConfigStore } from './storyConfig'
import { useStoryPlanStore } from './storyPlan'

export type StoryOption = {
  type: 'progress' | 'unexpected' | 'other'
  text: string
}

// Deterministic short hash for option IDs (per page index + text)
function makeOptionId(baseIndex: number, text: string): string {
  let h = baseIndex | 0
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i)
    h |= 0
  }
  // to unsigned hex
  const hex = (h >>> 0).toString(16)
  return `${baseIndex}-${hex}`
}

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

type GeneratedPage = {
  page: StoryPage
  notesDelta: string[]
  subToCheck?: { pointIndex: number; subIndex: number; text: string } | null
}

function coerceOptions(raw: any): string[] {
  // Map three plain-text options in the order returned
  const texts: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const t = typeof item === 'string' ? String(item) : String(item?.text ?? '')
      if (t && t.trim()) texts.push(t.trim())
    }
  }
  const fallback = [
    'Take the most straightforward next step',
    'Do something surprising and risky',
    'Try an alternative approach',
  ]
  const a = texts[0] ?? fallback[0]
  const b = texts[1] ?? fallback[1]
  const c = texts[2] ?? fallback[2]
  return [a, b, c]
}

export const useStoryStore = defineStore('story', () => {
  const text = useStorage<string>('storyarc.story.text', '')
  const options = useStorage<string[]>('storyarc.story.options', [])
  const summary = useStorage<string>('storyarc.story.summary', '')
  const notes = useStorage<string[]>('storyarc.story.notes', [])
  const loading = useStorage<boolean>('storyarc.story.loading', false)
  const error = useStorage<string | null>('storyarc.story.error', null)
  const turn = useStorage<number>('storyarc.story.turn', 0)

  // New paged flow state
  const pages = useStorage<StoryPage[]>('storyarc.story.pages', [], undefined, {
    serializer: StorageSerializers.object,
  })
  const index = useStorage<number>('storyarc.story.index', 0)
  const nextPrefetch = useStorage<GeneratedPage | null>(
    'storyarc.story.nextPrefetch',
    null,
    undefined,
    {
      serializer: StorageSerializers.object,
    },
  )
  // Map: baseKey (page index string) -> { optionId: GeneratedPage }
  const branchPrefetch = useStorage<Record<string, Record<string, GeneratedPage>>>(
    'storyarc.story.branchPrefetch',
    {},
    undefined,
    { serializer: StorageSerializers.object },
  )

  // Track in-flight branch generations to avoid duplicates
  const branchInFlight = new Set<string>()

  const hasStarted = computed(() => pages.value.length > 0)
  const currentPage = computed<StoryPage | null>(() => pages.value[index.value] ?? null)
  const currentOptions = computed<string[]>(() => currentPage.value?.options ?? [])
  // choiceLabels removed; use currentOptions directly
  const canGoPrev = computed(() => index.value > 0)
  const canGoNext = computed(() => {
    const cp = currentPage.value
    if (!cp) return false
    if (cp.options && cp.options.length) return false // must choose instead of next
    // If a committed next page already exists (navigating back case), allow
    if (index.value < pages.value.length - 1) return true
    // Otherwise require prefetch
    return !!nextPrefetch.value
  })

  // Choices only render when branch prefetch exists for the current page.
  const hasBranchPrefetchForCurrent = computed(() => {
    const cp = currentPage.value
    if (!cp || !cp.options || cp.options.length !== 3) return true // no branches required
    const baseIndex = index.value
    const ids = cp.options.map((t) => makeOptionId(baseIndex, t))
    const cached = branchPrefetch.value[`${baseIndex}`] || {}
    return ids.every((id) => !!cached[id])
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
    nextPrefetch.value = null
    branchPrefetch.value = {}
    branchInFlight.clear()
  }

  function rebuildTranscriptUpTo(idx: number) {
    const lines: string[] = []
    for (let i = 0; i <= idx && i < pages.value.length; i++) lines.push(pages.value[i].passage)
    text.value = lines.join('\n\n')
  }

  async function generatePage(opts: {
    nextChoice?: string
    allowOptions?: boolean
    substepHint?: string | null
    background?: boolean
  }) {
    const cfg = useStoryConfigStore()
    const plan = useStoryPlanStore()

    // Choose a subtle focus for this turn with equal probability
    type FocusMode = 'substep' | 'world' | 'character'
    const modes: FocusMode[] = ['substep', 'world', 'character']
    let chosen: FocusMode = modes[Math.floor(Math.random() * modes.length)]
    let subToAdvance: { pointIndex: number; subIndex: number; text: string } | null = null
    if (chosen === 'substep') {
      subToAdvance = plan.getNextSubstep()
      if (!subToAdvance) {
        // Fallback to a non-plan focus if no substep available yet
        chosen = Math.random() < 0.5 ? 'world' : 'character'
      }
    }

    const sys: ChatMessage = {
      role: 'system',
      content: [
        buildSystemPromptFromConfig({
          world: cfg.world,
          inspirations: cfg.inspirations,
          likedCharacters: cfg.likedCharacters,
          genre: cfg.genre,
          tone: cfg.tone,
        }),
        // Subtle focus directive for this turn
        chosen === 'substep' && subToAdvance
          ? `This turn: subtly work toward this next planned sub-step: "${subToAdvance.text}". Weave it in naturally. Keep the focus slight; do not reveal any meta-planning or say you are following a plan.`
          : chosen === 'world'
            ? 'This turn: slightly emphasize immersive world-building with small concrete sensory details. Keep it subtle and balanced; do not overdo description.'
            : 'This turn: slightly emphasize character—subtle internal thoughts, small behaviors, voice. Keep it subtle and avoid heavy-handed exposition.',
        // Options control: only include options when explicitly allowed
        opts.allowOptions
          ? 'If fitting, you MAY offer the reader a choice. Only then include an "options" array of exactly three short plain strings (no prefixes).'
          : 'Do NOT include an "options" field for this page.',
        'Always answer strictly as JSON with fields: {"passage": string, "summary": string, "notes": string[], "options"?: [string, string, string]}.',
        'The "notes" array should contain at most 2 short bullet points of factual details to remember for future coherence (e.g., names, goals, discovered clues).',
        'Passage should be 6-8 short paragraphs.',
        'Write in a clear, approachable voice—concrete and to the point. Avoid flowery or overly abstract language. Keep it readable and engaging without being simplistic.',
        'Do not recap or explicitly repeat what already happened in earlier pages unless strictly necessary. Let the scene progress naturally and vary word choice to avoid repetition.',
        'If options are present, they must be exactly three and short. They must not be prefixed with anything. Just things like "go towards the water" or "ask her if she wants to dance" or "run away".',
      ]
        .filter(Boolean)
        .join('\n'),
    }

    const userParts: string[] = []
    if (summary.value) userParts.push(`Previous summary: ${summary.value}`)
    if (notes.value.length) {
      userParts.push('Memory notes (persist across turns, keep consistent):')
      for (const n of notes.value) userParts.push(`- ${n}`)
    }
    // Include last 3 pages as context
    if (pages.value.length) {
      const start = Math.max(0, pages.value.length - 3)
      userParts.push('Recent story context (last 3 pages):')
      for (let i = start; i < pages.value.length; i++) {
        userParts.push(`-- Page ${i + 1} --`)
        userParts.push(pages.value[i].passage)
      }
    }
    if (opts.nextChoice) userParts.push(`Player choice: ${opts.nextChoice}`)
    if (!summary.value && !opts.nextChoice)
      userParts.push('Start the story now with an opening passage.')
    userParts.push('Return strictly the JSON format described.')

    const usr: ChatMessage = { role: 'user', content: userParts.join('\n') }

    // Debug logging: remembered notes, chosen path, and full system prompt
    try {
      const pathLabel = opts.nextChoice ? `branch: ${opts.nextChoice}` : 'linear'
      const mode = opts.background ? 'prefetch' : 'active'
      // eslint-disable-next-line no-console
      console.groupCollapsed(`[StoryArc] generatePage (${mode}) path=${pathLabel}`)
      // eslint-disable-next-line no-console
      console.debug('Remembered notes:', notes.value)
      // eslint-disable-next-line no-console
      console.debug('System prompt:', sys.content)
      // eslint-disable-next-line no-console
      console.debug('User message:', usr.content)
      // eslint-disable-next-line no-console
      console.groupEnd()
    } catch {}

    const bg = !!opts.background
    if (!bg) {
      loading.value = true
      error.value = null
    }
    try {
      const res = await chat([sys, usr], {
        response_format: { type: 'json_object' },
      })
      let data: any
      try {
        data = JSON.parse(res.content)
      } catch (e) {
        throw new Error('Model returned non-JSON response')
      }
      const passage = (data?.passage ?? '').toString()
      const newSummary = (data?.summary ?? '').toString()
      // Only consider options if explicitly allowed and exactly 3 provided
      const rawOpts = Array.isArray(data?.options) ? data.options : null
      const newOptions =
        opts.allowOptions && Array.isArray(rawOpts) && rawOpts.length === 3
          ? coerceOptions(rawOpts)
          : []
      const newNotes = Array.isArray(data?.notes)
        ? data.notes
            .map((x: any) => String(x))
            .filter((s: string) => s.trim().length > 0)
            .slice(0, 2)
        : []

      if (!passage) throw new Error('Missing passage in model response')

      const gp: GeneratedPage = {
        page: { passage, summary: newSummary, options: newOptions.length ? newOptions : undefined },
        notesDelta: newNotes,
        subToCheck: chosen === 'substep' && subToAdvance ? subToAdvance : null,
      }

      // Verify substep completion only when we actually commit (handled by commitPage)
      return gp
    } catch (e: any) {
      if (!bg) {
        error.value = e?.message || 'Failed to continue story'
      }
      throw e
    } finally {
      if (!bg) loading.value = false
    }
  }

  function applyNotesDelta(delta: string[]) {
    if (!delta.length) return
    const merged = Array.from(new Set([...notes.value, ...delta]))
    notes.value = merged
  }

  async function commitPage(gp: GeneratedPage) {
    // If we are not at the end, truncate forward pages to maintain a single timeline
    if (index.value < pages.value.length - 1) {
      const removeFrom = index.value + 1
      const removedCount = pages.value.length - removeFrom
      if (removedCount > 0) {
        pages.value.splice(removeFrom)
        // Clear any branch prefetch entries at or beyond the removed range
        const keys = Object.keys(branchPrefetch.value)
        for (const k of keys) {
          const n = Number(k)
          if (!Number.isNaN(n) && n >= removeFrom) delete branchPrefetch.value[k]
        }
        nextPrefetch.value = null
      }
    }
    // Ensure optionIds are set deterministically at commit time
    if (gp.page.options && gp.page.options.length === 3) {
      const baseIndex = pages.value.length // will be the index after push
      gp.page.optionIds = gp.page.options.map((t) => makeOptionId(baseIndex, t))
    }
    pages.value.push(gp.page)
    index.value = pages.value.length - 1
    summary.value = gp.page.summary
    applyNotesDelta(gp.notesDelta)
    turn.value += 1
    rebuildTranscriptUpTo(index.value)

    // Optional: verify substep accomplished
    const subToCheck = gp.subToCheck
    if (subToCheck) {
      try {
        const verifySys: ChatMessage = {
          role: 'system',
          content:
            'You are a precise verifier. Decide if the provided story passage has clearly accomplished the given planned sub-step. Respond STRICTLY as JSON: {"done": boolean}. If uncertain, return done: false. No extra keys.',
        }
        const verifyUsr: ChatMessage = {
          role: 'user',
          content: [
            `Planned sub-step to check: "${subToCheck.text}"`,
            'Story passage to evaluate:',
            gp.page.passage,
            'Question: Did this passage clearly achieve the planned sub-step in a natural way? Return JSON only.',
          ].join('\n'),
        }
        const vr = await chat([verifySys, verifyUsr], {
          model: 'gpt-5-mini',
          reasoning_effort: 'low',
          response_format: { type: 'json_object' },
          max_completion_tokens: 100,
        })
        let verdict: any
        try {
          verdict = JSON.parse(vr.content)
        } catch {}
        if (verdict && typeof verdict.done === 'boolean' && verdict.done === true) {
          const plan = useStoryPlanStore()
          plan.markSubstepDone(subToCheck.pointIndex, subToCheck.subIndex)
        }
      } catch {}
    }
  }

  async function prefetchNextForCurrent() {
    // Only prefetch at the frontier (current is the last committed page)
    if (index.value !== pages.value.length - 1) return

    // If current page already has options, prefetch branches for the current index and do not generate a linear next
    const cp = currentPage.value
    if (cp && cp.options && cp.options.length === 3) {
      const baseIndex = index.value
      const baseKey = `${baseIndex}`
      // Ensure optionIds persisted on the current page
      if (!cp.optionIds || cp.optionIds.length !== 3) {
        const ids = cp.options.map((t) => makeOptionId(baseIndex, t))
        // mutate stored page to include ids
        pages.value[baseIndex] = { ...cp, optionIds: ids }
      }
      const ids = (pages.value[baseIndex].optionIds as string[])
      const existing = branchPrefetch.value[baseKey] || {}
      const toFetch: Array<{ id: string; text: string }> = []
      cp.options.forEach((opt, i) => {
        const id = ids[i]
        const key = `${baseKey}:${id}`
        if (!existing[id] && !branchInFlight.has(key)) {
          branchInFlight.add(key)
          toFetch.push({ id, text: opt })
        }
      })
      if (toFetch.length) {
        const results = await Promise.allSettled(
          toFetch.map((item) =>
            generatePage({ nextChoice: item.text, allowOptions: Math.random() < 0.1, background: true }).finally(
              () => branchInFlight.delete(`${baseKey}:${item.id}`),
            ),
          ),
        )
        const merged = { ...existing }
        let idx = 0
        for (const r of results) {
          const item = toFetch[idx++]
          if (r.status === 'fulfilled' && r.value) merged[item.id] = r.value
        }
        branchPrefetch.value = { ...branchPrefetch.value, [baseKey]: merged }
      }
      nextPrefetch.value = null
      return
    }

    const allowOptions = Math.random() < 0.1
    try {
      const gp = await generatePage({ allowOptions, background: true })
      // Assign optionIds for the next page deterministically (index + 1)
      if (gp.page.options && gp.page.options.length === 3) {
        const nextIndex = index.value + 1
        gp.page.optionIds = gp.page.options.map((t) => makeOptionId(nextIndex, t))
      }
      nextPrefetch.value = gp
      // If next page contains options, prefetch branches for it (index + 1)
      if (gp.page.options && gp.page.options.length === 3) {
        const baseIndex = index.value + 1
        const baseKey = `${baseIndex}`
        const ids = gp.page.optionIds as string[]
        const existing = branchPrefetch.value[baseKey] || {}
        const toFetch: Array<{ id: string; text: string }> = []
        gp.page.options.forEach((opt, i) => {
          const id = ids[i]
          const key = `${baseKey}:${id}`
          if (!existing[id] && !branchInFlight.has(key)) {
            branchInFlight.add(key)
            toFetch.push({ id, text: opt })
          }
        })
        if (toFetch.length) {
          const results = await Promise.allSettled(
            toFetch.map((item) =>
              generatePage({ nextChoice: item.text, allowOptions: Math.random() < 0.1, background: true }).finally(
                () => branchInFlight.delete(`${baseKey}:${item.id}`),
              ),
            ),
          )
          const merged = { ...existing }
          let idx = 0
          for (const r of results) {
            const item = toFetch[idx++]
            if (r.status === 'fulfilled' && r.value) merged[item.id] = r.value
          }
          branchPrefetch.value = { ...branchPrefetch.value, [baseKey]: merged }
        }
      }
    } catch {
      // background prefetch errors are ignored
    }
  }

  async function startIfNeeded() {
    if (!hasStarted.value) {
      // First page
      const gp = await generatePage({ allowOptions: Math.random() < 0.1 })
      await commitPage(gp)
      // Pre-generate next page
      await prefetchNextForCurrent()
    }
  }

  async function goPrev() {
    if (index.value > 0) {
      index.value -= 1
      rebuildTranscriptUpTo(index.value)
      // If there is already a committed next page from this position, no need to prefetch
      if (index.value < pages.value.length - 1) {
        nextPrefetch.value = null
      } else {
        // otherwise prepare the next page in advance
        nextPrefetch.value = null
        await prefetchNextForCurrent()
      }
    }
  }

  async function goNext() {
    if (!canGoNext.value) return
    // If a committed next page already exists (navigated back case)
    if (index.value < pages.value.length - 1) {
      index.value += 1
      summary.value = pages.value[index.value].summary
      rebuildTranscriptUpTo(index.value)
      // Prepare next prefetch only if at the frontier
      if (index.value === pages.value.length - 1) {
        nextPrefetch.value = null
        await prefetchNextForCurrent()
      }
      return
    }
    // Otherwise consume prefetch and commit
    if (!nextPrefetch.value) return
    const gp = nextPrefetch.value
    nextPrefetch.value = null
    await commitPage(gp)
    await prefetchNextForCurrent()
  }

  async function chooseSuggestion(label: string) {
    // For current page options
    const cp = currentPage.value
    if (!cp || !cp.options || !cp.options.length) return
    const optIndex = cp.options.findIndex((l) => l === label)
    const resolvedIndex = optIndex >= 0 ? optIndex : 0
    const baseIndex = index.value
    const baseKey = `${baseIndex}`
    const id = makeOptionId(baseIndex, cp.options[resolvedIndex])
    const cache = branchPrefetch.value[baseKey]
    const chosenPage = cache?.[id]
    if (chosenPage) {
      // Commit cached branch
      delete branchPrefetch.value[baseKey]
      await commitPage(chosenPage)
      // Remove options from the source choice page so Next works when navigating back
      const src = pages.value[baseIndex]
      if (src && src.options && src.options.length) {
        pages.value[baseIndex] = { ...src, options: undefined, optionIds: undefined }
      }
      await prefetchNextForCurrent()
    } else {
      // Generate synchronously if cache missing
      const choiceText = cp.options[resolvedIndex] ?? label
      const gp = await generatePage({ nextChoice: choiceText, allowOptions: Math.random() < 0.1 })
      await commitPage(gp)
      // Remove options from the source choice page so Next works when navigating back
      const src = pages.value[baseIndex]
      if (src && src.options && src.options.length) {
        pages.value[baseIndex] = { ...src, options: undefined, optionIds: undefined }
      }
      await prefetchNextForCurrent()
    }
  }

  // No freeform input supported anymore

  return {
    // state
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
    nextPrefetch,
    canGoPrev,
    canGoNext,
    hasBranchPrefetchForCurrent,
    // actions
    reset,
    startIfNeeded,
    goPrev,
    goNext,
    chooseSuggestion,
  }
})
