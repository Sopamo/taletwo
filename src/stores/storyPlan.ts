import { defineStore } from 'pinia'
import { useStorage, StorageSerializers } from '@vueuse/core'
import { chat, buildPlannerSystemPromptFromConfig, type ChatMessage } from '@/lib/llm'
import { useStoryConfigStore } from './storyConfig'

export type StoryPoint = {
  title: string
  brief: string
  substeps?: string[]
}

export type StoryPlan = {
  overallIdea: string
  conflict: string
  points: StoryPoint[]
}

export const useStoryPlanStore = defineStore('storyPlan', () => {
  // Clean up legacy invalid value like "[object Object]"
  if (typeof window !== 'undefined') {
    try {
      const rawNew = window.localStorage.getItem('taletwo.plan')
      if (rawNew && rawNew.startsWith('[object')) {
        window.localStorage.removeItem('taletwo.plan')
      }
      const rawOld = window.localStorage.getItem('storyarc.plan')
      if (rawOld && rawOld.startsWith('[object')) {
        window.localStorage.removeItem('storyarc.plan')
      }
    } catch {}
  }

  const plan = useStorage<StoryPlan | null>('taletwo.plan', null, undefined, {
    serializer: StorageSerializers.object,
  })
  const loading = useStorage<boolean>('taletwo.plan.loading', false)
  const error = useStorage<string | null>('taletwo.plan.error', null)
  const curPoint = useStorage<number>('taletwo.plan.curPoint', 0)
  const curSub = useStorage<number>('taletwo.plan.curSub', 0)

  function resetProgress() {
    curPoint.value = 0
    curSub.value = 0
  }

  function resetAll() {
    plan.value = null
    loading.value = false
    error.value = null
    resetProgress()
  }

  const isReady = () => {
    const p = plan.value
    if (!p || !Array.isArray(p.points) || p.points.length === 0) return false
    return p.points.every((pt) => Array.isArray(pt.substeps) && pt.substeps.length > 0)
  }

  async function generatePlan() {
    const cfg = useStoryConfigStore()
    loading.value = true
    error.value = null
    try {
      // Ask for a non-obvious core conflict and an overall idea/goal, plus 6-9 story points (no substeps yet)
      const sys: ChatMessage = {
        role: 'system',
        content: [
          buildPlannerSystemPromptFromConfig({
            books: cfg.books,
            world: cfg.world,
            mainCharacter: cfg.mainCharacter,
            genre: cfg.genre,
          }),
          'Act as a narrative planner. Think deeply about a non-obvious core conflict and an overall idea for what the story ultimately wants to say. Then outline 6-9 high-level story points that trace a coherent story arc (e.g., setup, inciting incident, rising tension, midpoint, crisis, climax, resolution).',
          'This prompt is only about planning the story points; do not mention or consider reader choices or options.',
          'Respond strictly as JSON with: {"overallIdea": string, "conflict": string, "points": [{"title": string, "brief": string}, ...]}.',
        ].join('\n'),
      }
      const usr: ChatMessage = {
        role: 'user',
        content: 'Generate an overall idea and a non-obvious core conflict, then 6-9 story points (title + brief). No substeps yet. Return JSON only.',
      }
      const res = await chat([sys, usr], {
        response_format: { type: 'json_object' },
        reasoning_effort: 'high',
      })
      let data: any
      try {
        data = JSON.parse(res.content)
      } catch (e) {
        throw new Error('Planner returned non-JSON response')
      }
      const overallIdea = (data?.overallIdea ?? '').toString()
      const conflict = (data?.conflict ?? '').toString()
      const ptsRaw = Array.isArray(data?.points) ? data.points : []
      const points: StoryPoint[] = ptsRaw
        .map((p: any) => ({ title: String(p?.title ?? ''), brief: String(p?.brief ?? '') }))
        .filter((p: StoryPoint) => p.title && p.brief)
      if (!overallIdea || !conflict || points.length < 3) {
        throw new Error('Planner response missing idea, conflict, or sufficient points')
      }
      plan.value = { overallIdea, conflict, points }
      resetProgress()
    } catch (e: any) {
      error.value = e?.message || 'Failed to generate plan'
    } finally {
      loading.value = false
    }
  }

  async function expandSubstepsBatch(startIndex: number) {
    if (!plan.value) return
    const cfg = useStoryConfigStore()
    const allPoints = plan.value.points.map((p, i) => ({ index: i, title: p.title, brief: p.brief }))
    const batch = allPoints.slice(startIndex, startIndex + 3)
    if (batch.length === 0) return

    const sys: ChatMessage = {
      role: 'system',
      content: [
        buildPlannerSystemPromptFromConfig({
          books: cfg.books,
          world: cfg.world,
          mainCharacter: cfg.mainCharacter,
          genre: cfg.genre,
        }),
        'You will expand story points into actionable sub-steps to guide narrative progression. Keep sub-steps brief (one line) and concrete.',
        'Respond strictly as JSON: {"items": [{"index": number, "substeps": [string, ...]}]}',
      ].join('\n'),
    }
    const usr: ChatMessage = {
      role: 'user',
      content: [
        'Overall plan context (do not generate substeps for points outside the batch):',
        `Overall idea: ${plan.value.overallIdea}`,
        `Core conflict: ${plan.value.conflict}`,
        'Current main story point (guiding context):',
        (() => {
          const idx = curPoint.value
          const pt = plan.value?.points?.[idx]
          if (!pt) return 'None yet.'
          return JSON.stringify({ index: idx, title: pt.title, brief: pt.brief })
        })(),
        'All story points (context only):',
        JSON.stringify(allPoints),
        'Expand substeps ONLY for this batch of points (by index). Provide 3-6 substeps per point:',
        JSON.stringify(batch),
      ].join('\n'),
    }

    const res = await chat([sys, usr], {
      response_format: { type: 'json_object' },
    })
    let data: any
    try {
      data = JSON.parse(res.content)
    } catch (e) {
      throw new Error('Substep generator returned non-JSON response')
    }
    const items = Array.isArray(data?.items) ? data.items : []
    for (const it of items) {
      const idx = Number(it?.index)
      const arr = Array.isArray(it?.substeps)
        ? it.substeps.map((s: any) => String(s)).filter((s: string) => s.trim().length > 0)
        : []
      if (Number.isInteger(idx) && plan.value.points[idx] && arr.length) {
        plan.value.points[idx] = { ...plan.value.points[idx], substeps: arr }
      }
    }
  }

  async function expandAllSubsteps() {
    if (!plan.value) return
    const tasks: Promise<void>[] = []
    for (let i = 0; i < plan.value.points.length; i += 3) {
      tasks.push(expandSubstepsBatch(i))
    }
    // Run all batches in parallel and wait for all to settle
    await Promise.allSettled(tasks)

    // After generation, log all points with their substeps as Markdown for debugging/inspection
    try {
      const p = plan.value
      if (!p) return
      const lines: string[] = []
      lines.push(`# Story Plan`)
      lines.push(`\n**Overall Idea:** ${p.overallIdea}`)
      lines.push(`\n**Core Conflict:** ${p.conflict}`)
      lines.push('')
      p.points.forEach((pt, i) => {
        lines.push(`## ${i + 1}. ${pt.title}`)
        lines.push(`Brief: ${pt.brief}`)
        if (Array.isArray(pt.substeps) && pt.substeps.length) {
          pt.substeps.forEach((s, j) => lines.push(`- ${j + 1}. ${s}`))
        } else {
          lines.push('- (no substeps)')
        }
        lines.push('')
      })
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'))
    } catch {}
  }

  async function ensureReady() {
    // Re-generate if plan missing
    if (!plan.value) {
      await generatePlan()
    }
    if (!plan.value) return // bail if generation failed
    if (!isReady()) {
      await expandAllSubsteps()
    }
  }

  function getNextSubstep(): { pointIndex: number; subIndex: number; text: string } | null {
    if (!plan.value) return null
    const pt = plan.value.points[curPoint.value]
    if (!pt || !pt.substeps || pt.substeps.length === 0) return null
    const text = pt.substeps[curSub.value]
    if (!text) return null
    return { pointIndex: curPoint.value, subIndex: curSub.value, text }
  }

  function markSubstepDone(pointIndex: number, subIndex: number) {
    if (!plan.value) return
    if (pointIndex !== curPoint.value || subIndex !== curSub.value) return
    const pt = plan.value.points[curPoint.value]
    if (!pt || !pt.substeps) return
    const nextSub = curSub.value + 1
    if (nextSub < pt.substeps.length) {
      curSub.value = nextSub
    } else {
      curPoint.value = Math.min(curPoint.value + 1, plan.value.points.length)
      curSub.value = 0
    }
  }

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
