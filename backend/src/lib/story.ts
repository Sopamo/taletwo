import { ObjectId, type Collection, type WithId } from 'mongodb'
import type { BookDoc, ChatMessage, StoryPage, StoryPlan, StoryPoint } from '../types'
import { chat, buildPlannerSystemPromptFromConfig, buildSystemPromptFromConfig } from './llm'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
import { getBooksCollection } from './db'

function makeOptionId(baseIndex: number, text: string): string {
  let h = baseIndex | 0
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i)
    h |= 0
  }
  const hex = (h >>> 0).toString(16)
  return `${baseIndex}-${hex}`
}

async function ensurePlan(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
): Promise<WithId<BookDoc>> {
  if (doc.plan && Array.isArray(doc.plan.points) && doc.plan.points.length) return doc
  const cfg = {
    books: doc.books,
    world: doc.world,
    mainCharacter: doc.mainCharacter,
    genre: doc.genre,
  }

  const sys: ChatMessage = {
    role: 'system',
    content: [
      buildPlannerSystemPromptFromConfig(cfg),
      'Act as a narrative planner. Think deeply about a non-obvious core conflict and an overall idea for what the story ultimately wants to say. Then outline 6-9 high-level story points that trace a coherent story arc (e.g., setup, inciting incident, rising tension, midpoint, crisis, climax, resolution).',
      'This prompt is only about planning the story points; do not mention or consider reader choices or options.',
      'Respond strictly as JSON with: {"overallIdea": string, "conflict": string, "points": [{"title": string, "brief": string}, ...]}.',
    ].join('\n'),
  }
  const usr: ChatMessage = {
    role: 'user',
    content:
      'Generate an overall idea and a non-obvious core conflict, then 6-9 story points (title + brief). No substeps yet. Return JSON only.',
  }
  const res = await chat([sys, usr], {
    response_format: { type: 'json_object' },
    reasoning_effort: 'medium',
    tag: 'planner:points',
  })
  let data: any
  try {
    data = JSON.parse(res.content)
  } catch {
    throw new Error('Planner returned non-JSON response')
  }
  const overallIdea = (data?.overallIdea ?? '').toString()
  const conflict = (data?.conflict ?? '').toString()
  let ptsRaw: any[] = []
  if (Array.isArray(data?.points)) {
    ptsRaw = data.points
  }
  const points: StoryPoint[] = ptsRaw
    .map((p: any) => ({ title: String(p?.title ?? ''), brief: String(p?.brief ?? '') }))
    .filter((p: StoryPoint) => p.title && p.brief)
  if (!overallIdea || !conflict || points.length < 3)
    throw new Error('Planner response missing idea, conflict, or sufficient points')

  const plan: StoryPlan = { overallIdea, conflict, points, curPoint: 0, curSub: 0 }
  await col.updateOne({ _id }, { $set: { plan, updatedAt: new Date() } })
  const fresh = await col.findOne({ _id })
  if (!fresh) throw new Error('Book not found after plan generation')
  return fresh
}

async function expandAllSubsteps(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
): Promise<WithId<BookDoc>> {
  if (!doc.plan) return doc
  const cfg = {
    books: doc.books,
    world: doc.world,
    mainCharacter: doc.mainCharacter,
    genre: doc.genre,
  }
  const allPoints = doc.plan.points.map((p, i) => ({ index: i, title: p.title, brief: p.brief }))

  const sys: ChatMessage = {
    role: 'system',
    content: [
      buildPlannerSystemPromptFromConfig(cfg),
      'You will expand story points into actionable sub-steps to guide narrative progression. Keep sub-steps brief (one line) and concrete.',
      'Respond strictly as JSON: {"items": [{"index": number, "substeps": [string, ...]}]}',
    ].join('\n'),
  }
  const usr: ChatMessage = {
    role: 'user',
    content: [
      'Overall plan context (do not generate substeps for points outside the batch):',
      `Overall idea: ${doc.plan.overallIdea}`,
      `Core conflict: ${doc.plan.conflict}`,
      'All story points (context only):',
      JSON.stringify(allPoints),
      'Expand substeps for ALL points. Provide 3-6 substeps per point.',
    ].join('\n'),
  }

  const res = await chat([sys, usr], {
    response_format: { type: 'json_object' },
    tag: 'planner:substeps',
  })
  let data: any
  try {
    data = JSON.parse(res.content)
  } catch {
    throw new Error('Substep generator returned non-JSON response')
  }
  let items: any[] = []
  if (Array.isArray(data?.items)) {
    items = data.items
  }
  const points = doc.plan.points.slice()
  for (const it of items) {
    const idx = Number(it?.index)
    let arr: string[] = []
    if (Array.isArray(it?.substeps)) {
      arr = it.substeps.map((s: any) => String(s)).filter((s: string) => s.trim().length > 0)
    } else {
      arr = []
    }
    if (Number.isInteger(idx) && points[idx] && arr.length) {
      points[idx] = { ...points[idx], substeps: arr }
    }
  }
  await col.updateOne({ _id }, { $set: { 'plan.points': points, updatedAt: new Date() } })
  const fresh = await col.findOne({ _id })
  if (!fresh) throw new Error('Book not found after substeps')
  return fresh
}

// Insert minimal introduction substeps for newly introduced characters/items/concepts.
// The model should only add short, clear introductions right before the first time an entity is relied upon.
async function insertIntroSubstepsForAllPoints(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
): Promise<WithId<BookDoc>> {
  if (!doc.plan || !Array.isArray(doc.plan.points) || !doc.plan.points.length) return doc
  const cfg = {
    books: doc.books,
    world: doc.world,
    mainCharacter: doc.mainCharacter,
    genre: doc.genre,
  }
  const allPoints = doc.plan.points.map((p, i) => ({
    index: i,
    title: p.title,
    brief: p.brief,
    substeps: Array.isArray(p.substeps) ? p.substeps : [],
  }))

  const sys: ChatMessage = {
    role: 'system',
    content: [
      buildPlannerSystemPromptFromConfig(cfg),
      'Task: Revise substeps by inserting minimal introductory substeps for any character, item, or concept that might not be obvious to the reader when it first appears.',
      'Rules:',
      '- Do NOT remove existing substeps; only insert introductions when genuinely needed.',
      '- Place an introduction BEFORE the first substep where the entity is relied upon.',
      '- If an entity was already adequately introduced earlier, do not add duplicates.',
      '- Keep each point concise; aim for at most 7 substeps per point after insertion.',
      'Respond STRICTLY as JSON, listing all the existing points + any new ones: {"items": [{"index": number, "substeps": [string, ...]}]}',
    ].join('\n'),
  }
  const usr: ChatMessage = {
    role: 'user',
    content: [
      'Overall plan context:',
      `Overall idea: ${doc.plan.overallIdea}`,
      `Core conflict: ${doc.plan.conflict}`,
      'All points with current substeps:',
      JSON.stringify(allPoints),
      'Return updated substeps per point, inserting only minimal introductions where needed. JSON only.',
    ].join('\n'),
  }
  try {
    const res = await chat([sys, usr], {
      response_format: { type: 'json_object' },
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      tag: 'intro:insert',
    })
    let data: any
    try {
      data = JSON.parse(res.content)
    } catch {
      return doc
    }
    let items: any[] = []
    if (Array.isArray(data?.items)) items = data.items
    if (!items.length) return doc
    const points = doc.plan.points.slice()
    for (const it of items) {
      const idx = Number(it?.index)
      if (!Number.isInteger(idx) || !points[idx]) continue
      const arr: string[] = Array.isArray(it?.substeps)
        ? (it.substeps as any[]).map((s) => String(s)).filter((s) => s.trim().length > 0)
        : []
      if (arr.length) points[idx] = { ...points[idx], substeps: arr }
    }
    await col.updateOne({ _id }, { $set: { 'plan.points': points, updatedAt: new Date() } })
    const fresh = await col.findOne({ _id })
    return fresh ?? doc
  } catch {
    return doc
  }
}

function getNextSubstep(
  doc: WithId<BookDoc>,
): { pointIndex: number; subIndex: number; text: string } | null {
  const plan = doc.plan
  if (!plan) return null
  const pt = plan.points[plan.curPoint]
  if (!pt || !pt.substeps || !pt.substeps.length) return null
  const text = pt.substeps[plan.curSub]
  if (!text) return null
  return { pointIndex: plan.curPoint, subIndex: plan.curSub, text }
}

async function markSubstepDone(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
  pointIndex: number,
  subIndex: number,
) {
  const plan = doc.plan
  if (!plan) return
  if (pointIndex !== plan.curPoint || subIndex !== plan.curSub) return
  const pt = plan.points[plan.curPoint]
  if (!pt || !pt.substeps) return
  let curPoint = plan.curPoint
  let curSub = plan.curSub + 1
  if (curSub >= pt.substeps.length) {
    curPoint = Math.min(curPoint + 1, plan.points.length)
    curSub = 0
  }
  await col.updateOne(
    { _id },
    { $set: { 'plan.curPoint': curPoint, 'plan.curSub': curSub, updatedAt: new Date() } },
  )
}

function mergeNotes(existing: string[], delta: string[]): string[] {
  if (!delta?.length) return existing
  return Array.from(new Set([...(existing || []), ...delta]))
}

async function verifySubstep(
  passage: string,
  subText: string,
  ctx?: { recent?: string[]; notes?: string[] },
): Promise<boolean> {
  try {
    const verifySys: ChatMessage = {
      role: 'system',
      content:
        'You are a precise verifier. Decide if the provided story passage has accomplished the given planned sub-step. Respond STRICTLY as JSON: {"done": boolean}. Err on the side of returning true. We do not want to linger too long on the same thing.',
    }
    const recent = Array.isArray(ctx?.recent) ? (ctx!.recent as string[]) : []
    const notes = Array.isArray(ctx?.notes) ? (ctx!.notes as string[]) : []
    const verifyUsr: ChatMessage = {
      role: 'user',
      content: [
        `Planned sub-step to check: "${subText}"`,
        'Recent context (last up to 3 pages):',
        ...recent.map((p, i) => `-- Context ${i + 1} --\n${p}`),
        'Memory notes (facts to consider for whether the step was achieved):',
        ...notes.map((n) => `- ${n}`),
        'Story passage to evaluate (current page):',
        passage,
        'Question: Considering the recent context and notes, did this passage achieve the planned sub-step? Return JSON only.',
      ].join('\n'),
    }
    const vr = await chat([verifySys, verifyUsr], {
      reasoning_effort: 'minimal',
      model: 'gpt-5-nano',
      response_format: { type: 'json_object' },
      tag: 'verify:substep',
    })
    const verdict = JSON.parse(vr.content)
    return !!(verdict && typeof verdict.done === 'boolean' && verdict.done === true)
  } catch {
    return false
  }
}

// After a branching choice, adapt the high-level plan to align with the new trajectory.
async function adaptPlanAfterChoice(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
  params: { pageIndex: number; choice: string; committedPage: StoryPage },
): Promise<void> {
  const plan = (doc as any).plan
  if (!plan || !Array.isArray(plan.points) || !plan.points.length) return
  const cfg = {
    books: doc.books,
    world: doc.world,
    mainCharacter: doc.mainCharacter,
    genre: doc.genre,
  }
  const allPoints = plan.points.map((p: any, i: number) => ({
    index: i,
    title: String(p?.title ?? ''),
    brief: String(p?.brief ?? ''),
    substeps: Array.isArray(p?.substeps) ? (p.substeps as string[]) : [],
  }))
  const sys: ChatMessage = {
    role: 'system',
    content: [
      buildPlannerSystemPromptFromConfig(cfg),
      'Task: Revise the story plan to remain coherent after a player choice. Keep it concrete and actionable.',
      'Rules:',
      '- Preserve continuity: do not contradict what already happened.',
      '- You may merge/split/reorder future points to fit the new direction.',
      '- Provide 6–9 concise points; each has a short title and brief, plus 3–6 substeps.',
      '- Set curPoint/curSub to the next actionable substep after the just-committed page.',
      '- Try to stick closely to the original plan, but make sure to align with the new direction.',
      'Respond STRICTLY as JSON with this exact shape:',
      '{"overallIdea": string, "conflict": string, "points": [{"title": string, "brief": string, "substeps": string[]}], "curPoint": number, "curSub": number}',
    ].join('\n'),
  }
  const s = doc.story
  const recentSummary = s?.summary ? `Previous summary: ${s.summary}` : ''
  const usr: ChatMessage = {
    role: 'user',
    content: [
      'Current plan (with cursor):',
      `curPoint: ${plan.curPoint}, curSub: ${plan.curSub}`,
      'Points:',
      JSON.stringify(allPoints),
      '',
      'Player choice that set the new direction:',
      params.choice,
      '',
      'Just-committed page (use as ground truth for what happened):',
      `Page index: ${params.pageIndex}`,
      `Summary: ${params.committedPage.summary}`,
      `Passage: ${params.committedPage.passage}`,
      recentSummary,
      '',
      'Revise the plan to fit this trajectory. JSON only, no extra keys.',
    ].join('\n'),
  }
  try {
    const res = await chat([sys, usr], {
      response_format: { type: 'json_object' },
      reasoning_effort: 'medium',
      model: 'gpt-5',
      max_completion_tokens: 1200,
      tag: 'plan:adapt',
    })
    let data: any
    try {
      data = JSON.parse(res.content)
    } catch {
      return
    }
    const overallIdea = (data?.overallIdea ?? plan.overallIdea ?? '').toString()
    const conflict = (data?.conflict ?? plan.conflict ?? '').toString()
    const ptsRaw: any[] = Array.isArray(data?.points) ? data.points : []
    const points = ptsRaw
      .map((p: any) => ({
        title: String(p?.title ?? ''),
        brief: String(p?.brief ?? ''),
        substeps: Array.isArray(p?.substeps)
          ? (p.substeps as any[]).map((x) => String(x)).filter((x) => x.trim().length > 0)
          : [],
      }))
      .filter((p: any) => p.title && p.brief)
    const curPoint = Number.isInteger(data?.curPoint) ? Number(data.curPoint) : 0
    const curSub = Number.isInteger(data?.curSub) ? Number(data.curSub) : 0
    if (!overallIdea || !conflict || points.length < 3) return
    const newPlan: StoryPlan = { overallIdea, conflict, points, curPoint, curSub }
    await col.updateOne({ _id }, { $set: { plan: newPlan, updatedAt: new Date() } })
    // After changing points, run an introduction pass to insert minimal intros where needed
    const updatedDoc = await col.findOne({ _id })
    if (updatedDoc) {
      await insertIntroSubstepsForAllPoints(col, _id, updatedDoc as WithId<BookDoc>)
    }
  } catch {
    // Silent failure: keep old plan
  }
}

function coerceOptions(raw: any): string[] {
  const texts: string[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      let t: string
      if (typeof item === 'string') {
        t = String(item)
      } else {
        t = String(item?.text ?? '')
      }
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

async function generatePage(
  doc: WithId<BookDoc>,
  params: {
    upToIndex: number
    optionBaseIndex: number
    nextChoice?: string
    allowOptions?: boolean
  },
): Promise<{
  page: StoryPage
  notesDelta: string[]
  subToCheck?: { pointIndex: number; subIndex: number; text: string } | null
}> {
  type FocusMode = 'substep' | 'world' | 'character'
  const modes: FocusMode[] = ['substep', 'world', 'character']
  let chosen: FocusMode = modes[Math.floor(Math.random() * modes.length)]
  let subToAdvance: { pointIndex: number; subIndex: number; text: string } | null = null
  if (chosen === 'substep') {
    subToAdvance = getNextSubstep(doc)
    if (!subToAdvance) {
      if (Math.random() < 0.5) {
        chosen = 'world'
      } else {
        chosen = 'character'
      }
    }
  }

  // Determine if we are in a point-transition buildup window (final 1–2 substeps of the current point)
  // or at the opening of the story. If so, capture the upcoming major story point for subtle setup.
  let transitionInfo: { upcomingTitle: string; upcomingBrief: string } | null = null
  let isTransitionWindow = false
  try {
    const plan = (doc as any).plan
    if (plan && Array.isArray(plan.points) && plan.points.length) {
      const isOpening =
        !doc.story?.summary && !params.nextChoice && plan.curPoint === 0 && plan.curSub === 0
      if (isOpening) {
        const up = plan.points[0]
        if (up?.title && up?.brief)
          transitionInfo = { upcomingTitle: String(up.title), upcomingBrief: String(up.brief) }
        isTransitionWindow = true
      } else if (chosen === 'substep' && subToAdvance) {
        const pt = plan.points[plan.curPoint]
        let subs: string[] = []
        if (Array.isArray(pt?.substeps)) {
          subs = pt.substeps as string[]
        } else {
          subs = []
        }
        const remainingAfter = subs.length - (plan.curSub + 1)
        const hasNext = plan.curPoint + 1 < plan.points.length
        // In the final 1–2 substeps, begin priming the next major point (if it exists)
        if (hasNext && remainingAfter <= 1) {
          const up = plan.points[plan.curPoint + 1]
          if (up?.title && up?.brief)
            transitionInfo = { upcomingTitle: String(up.title), upcomingBrief: String(up.brief) }
          isTransitionWindow = true
        }
      }
    }
  } catch {}

  // If we're in a transition window, bias focus toward advancing the substep so the buildup occurs reliably.
  if (isTransitionWindow && chosen !== 'substep') {
    chosen = 'substep'
    if (!subToAdvance) subToAdvance = getNextSubstep(doc)
  }

  const sysContentParts: (string | undefined)[] = []
  sysContentParts.push(
    buildSystemPromptFromConfig({
      books: doc.books,
      world: doc.world,
      mainCharacter: doc.mainCharacter,
      genre: doc.genre,
    }),
  )
  // Dialogue dynamics: encourage interactive, reactive conversation
  sysContentParts.push(
    'Dialogue: Treat talk as action under pressure. Each turn should answer the prior move (answer, qualify, push back, or pivot) and carry its own small aim. Avoid orphaned declarations.',
  )
  sysContentParts.push(
    'Adjacency pairs: Close the loop—question→answer (or refusal), claim→challenge, offer→accept/decline. You may let a pair trail only if a beat undercuts it and creates a new hook.',
  )
  sysContentParts.push(
    'Beats & attribution: Weave brief action/reaction beats into the same sentence or the next to track speaker and status shifts. Prefer plain tags ("said", "asked"); keep names light; avoid ornate tags.',
  )
  sysContentParts.push(
    'Cadence: Favor 2–4 sentences per turn on average; mix one short with one longer, and let clauses link when useful. Reserve single-line volleys for heat; avoid machine-gun alternation.',
  )
  sysContentParts.push(
    'Subtext: Let motive leak through diction, silence, and beats rather than explicit explanation. Do not explain the feeling; show its pressure.',
  )
  let substepDirective: string | undefined
  if (chosen === 'substep' && subToAdvance) {
    substepDirective = `This turn: work toward this next planned sub-step: "${subToAdvance.text}". Remember: the reader is not aware of this planned step—do not assume they already know what's happening. Gently orient them and err slightly toward clarity using diegetic means (dialogue, internal thought, or concrete sensory description). Weave it in naturally. Do not reveal any meta-planning or say you are following a plan.`
  } else if (chosen === 'world') {
    sysContentParts.push(
      'This turn: slightly emphasize immersive world-building with small concrete sensory details. Keep it subtle and balanced; do not overdo description.',
    )
  } else {
    sysContentParts.push(
      'This turn: slightly emphasize character—subtle internal thoughts, small behaviors, voice. Keep it subtle and avoid heavy-handed exposition.',
    )
  }
  if (transitionInfo) {
    sysContentParts.push(
      'Point-transition buildup: You are approaching a major beat. Gently prime the next direction without revealing plans. Close or reframe the current micro-goal, then hinge using diegetic cues (obstacle, glance, gear check, invitation). If a new item/character matters, introduce one tagging detail and its functional role. Include one line implying immediate stakes. Avoid explicit forecast words ("next", "soon"), summaries, or meta commentary.',
    )
    sysContentParts.push(
      `Upcoming major beat (for your internal guidance only — do NOT reveal or mention plans): "${transitionInfo.upcomingTitle}" — ${transitionInfo.upcomingBrief}`,
    )
  }
  if (params.allowOptions) {
    sysContentParts.push(
      'If fitting, you MAY offer the reader a choice. Only then include an "options" array of exactly three short plain strings (no prefixes).',
    )
  } else {
    sysContentParts.push('Do NOT include an "options" field for this page.')
  }
  sysContentParts.push(
    'Always answer strictly as JSON with fields: {"passage": string, "summary": string, "notes": string[], "options"?: [string, string, string]}.',
    'The "notes" array should contain at most 2 short bullet points of factual details to remember for future coherence (e.g., names, goals, discovered clues).',
    'Passage should be 6-8 short paragraphs.',
    'Write in a clear, approachable voice—concrete and to the point. Avoid flowery or overly abstract language. Keep it readable and engaging without being simplistic.',
    'Do not recap or explicitly repeat what already happened in earlier pages unless strictly necessary. Let the scene progress naturally and vary word choice to avoid repetition.',
    'If options are present, they must be exactly three and short. They must not be prefixed with anything. Just things like "go towards the water" or "ask her if she wants to dance" or "run away".',
  )
  if (substepDirective) {
    sysContentParts.push(substepDirective)
  }
  const sys: ChatMessage = {
    role: 'system',
    content: sysContentParts.filter(Boolean).join('\n'),
  }

  const userParts: string[] = []
  const story = doc.story
  if (story?.summary) userParts.push(`Previous summary: ${story.summary}`)
  if (story?.notes?.length) {
    userParts.push('Memory notes (persist across turns, keep consistent):')
    for (const n of story.notes) userParts.push(`- ${n}`)
  }
  if (story?.pages?.length) {
    const last = Math.min(story.pages.length - 1, Math.max(-1, params.upToIndex))
    if (last >= 0) {
      const start = Math.max(0, last - 2)
      userParts.push('Recent story context (last 3 pages up to the chosen index):')
      for (let i = start; i <= last; i++) {
        userParts.push(`-- Page ${i + 1} --`)
        userParts.push(story.pages[i].passage)
      }
    }
  }
  if (params.nextChoice) userParts.push(`Player choice: ${params.nextChoice}`)
  if (!story?.summary && !params.nextChoice)
    userParts.push('Start the story now with an opening passage.')
  userParts.push('Return strictly the JSON format described.')

  const usr: ChatMessage = { role: 'user', content: userParts.join('\n') }

  const res = await chat([sys, usr], {
    reasoning_effort: 'low',
    response_format: { type: 'json_object' },
    tag: params.nextChoice ? 'page:generate:branch' : 'page:generate:next',
  })
  let data: any
  try {
    data = JSON.parse(res.content)
  } catch {
    throw new Error('Model returned non-JSON response')
  }
  const passage = (data?.passage ?? '').toString()
  const newSummary = (data?.summary ?? '').toString()
  let rawOpts: any[] | null = null
  if (Array.isArray(data?.options)) {
    rawOpts = data.options
  }
  let newOptions: string[] = []
  if (params.allowOptions && Array.isArray(rawOpts) && rawOpts.length === 3) {
    newOptions = coerceOptions(rawOpts)
  }
  let newNotes: string[] = []
  if (Array.isArray(data?.notes)) {
    newNotes = data.notes
      .map((x: any) => String(x))
      .filter((s: string) => s.trim().length > 0)
      .slice(0, 2)
  }
  if (!passage) throw new Error('Missing passage in model response')

  let optionsField: string[] | undefined = undefined
  if (newOptions.length) {
    optionsField = newOptions
  }
  const page: StoryPage = {
    passage,
    summary: newSummary,
    options: optionsField,
  }
  if (page.options && page.options.length === 3) {
    const baseIndex = params.optionBaseIndex
    page.optionIds = page.options.map((t) => makeOptionId(baseIndex, t))
  }
  let subToCheck: { pointIndex: number; subIndex: number; text: string } | null = null
  if (chosen === 'substep' && subToAdvance) {
    subToCheck = subToAdvance
  }
  return {
    page,
    notesDelta: newNotes,
    subToCheck,
  }
}

export async function ensurePlanReady(bookId: string): Promise<WithId<BookDoc>> {
  const _id = new ObjectId(bookId)
  const col = await getBooksCollection()
  const doc0 = await col.findOne({ _id })
  if (!doc0) throw new Error('Book not found')
  let ensured = await ensurePlan(col, _id, doc0)
  // ensure substeps present for all points
  const hasAll = ensured.plan?.points?.every(
    (p) => Array.isArray(p.substeps) && p.substeps.length > 0,
  )
  if (!hasAll) ensured = await expandAllSubsteps(col, _id, ensured)
  // always run an introduction pass to add minimal intros for newly introduced entities
  ensured = await insertIntroSubstepsForAllPoints(col, _id, ensured)
  return ensured
}

export async function startStory(bookId: string) {
  const col = await getBooksCollection()
  const _id = new ObjectId(bookId)
  let doc = await ensurePlanReady(bookId)
  // initialize story state if empty
  const now = new Date()
  if (!doc.story) {
    await col.updateOne(
      { _id },
      {
        $set: {
          story: {
            pages: [],
            index: 0,
            notes: [],
            summary: '',
            turn: 0,
            branchCache: {},
            branchPending: {},
            pendingVerify: null,
          },
          updatedAt: now,
        },
      },
    )
    doc = (await col.findOne({ _id })) as WithId<BookDoc>
  }
  const gp = await generatePage(doc, { upToIndex: -1, optionBaseIndex: 0, allowOptions: true })
  await commitPage(col, _id, doc, -1, gp)
  return await col.findOne({ _id })
}

async function commitPage(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
  fromIndex: number,
  gp: {
    page: StoryPage
    notesDelta: string[]
    subToCheck?: { pointIndex: number; subIndex: number; text: string } | null
  },
  opts?: { precompute?: boolean },
) {
  const story = doc.story ?? { pages: [], index: 0, notes: [], summary: '', turn: 0 }
  if (!(story as any).branchCache || typeof (story as any).branchCache !== 'object') {
    ;(story as any).branchCache = {}
  }
  if (!(story as any).branchPending || typeof (story as any).branchPending !== 'object') {
    ;(story as any).branchPending = {}
  }
  const pages = story.pages.slice()
  // truncate forward if navigating back scenario (not typical via API, but safe)
  pages.splice(fromIndex + 1)
  pages.push(gp.page)
  const index = fromIndex + 1
  const summary = gp.page.summary
  const notes = mergeNotes(story.notes, gp.notesDelta)
  const turn = (story.turn ?? 0) + 1
  const pendingVerify = gp.subToCheck
    ? {
        passage: gp.page.passage,
        subText: gp.subToCheck.text,
        pointIndex: gp.subToCheck.pointIndex,
        subIndex: gp.subToCheck.subIndex,
      }
    : null
  await col.updateOne(
    { _id },
    {
      $set: {
        story: {
          pages,
          index,
          notes,
          summary,
          turn,
          branchCache: (story as any).branchCache,
          branchPending: (story as any).branchPending,
          pendingVerify,
        },
        updatedAt: new Date(),
      },
    },
  )
  // After committing a page, prune any stale branch cache entries (older page indices)
  await pruneBranchCache(col, _id)
  if (opts?.precompute !== false) {
    // Precompute the default "Next" continuation for this page (fire-and-forget)
    precomputeNext(col, _id, index).catch(() => {})
    // If the committed page has choices, precompute branches in the background
    if (
      gp.page.optionIds &&
      gp.page.options &&
      gp.page.optionIds.length === gp.page.options.length
    ) {
      // Fire-and-forget; don't block the response
      precomputeBranches(
        col,
        _id,
        index,
        gp.page.optionIds.map((id, i) => ({ optionId: id, text: gp.page.options![i] })),
      ).catch(() => {})
    }
  }
}

export async function nextStory(bookId: string, index: number) {
  const col = await getBooksCollection()
  const _id = new ObjectId(bookId)
  const doc = (await col.findOne({ _id })) as WithId<BookDoc>
  const story = doc.story
  if (!story) throw new Error('Story not started')
  const maxIndex = (story.pages?.length ?? 0) - 1
  if (!Number.isInteger(index) || index < -1 || index > maxIndex)
    throw new Error(`Invalid index ${index}; must be between -1 and ${maxIndex}`)
  // Try to use precomputed default-next if available for the provided index
  if (story) {
    const key = `${index}:__next__`
    const cached = (story as any).branchCache?.[key]
    if (cached && cached.page) {
      await commitPage(col, _id, doc, index, cached)
      return await col.findOne({ _id })
    }
  }
  // Ensure readiness using the shared pending guard; then consume cached branch
  await ensureNextReady(bookId, index)
  const fresh = (await col.findOne({ _id })) as WithId<BookDoc>
  const key = `${index}:__next__`
  const cached = (fresh as any)?.story?.branchCache?.[key]
  if (!cached || !cached.page) throw new Error('Next page not available after readiness')
  await commitPage(col, _id, fresh!, index, cached)
  return await col.findOne({ _id })
}

export async function chooseStory(
  bookId: string,
  params: { index: number; optionId?: string; text?: string },
) {
  const col = await getBooksCollection()
  const _id = new ObjectId(bookId)
  let doc = await ensurePlanReady(bookId)
  const story = doc.story
  if (!story) throw new Error('Story not started')
  const curIndex = params.index
  const maxIndex = (story.pages?.length ?? 0) - 1
  if (!Number.isInteger(curIndex) || curIndex < 0 || curIndex > maxIndex)
    throw new Error(`Invalid index ${curIndex}; must be between 0 and ${maxIndex}`)
  const { optionId, text } = params ?? {}
  // Resolve choice text from optionId if needed (before any early returns)
  let resolvedChoice = (text || '').trim()
  if (!resolvedChoice && optionId) {
    const page0 = story.pages[curIndex]
    const idx0 = page0?.optionIds?.indexOf(optionId) ?? -1
    if (idx0 >= 0 && page0?.options?.[idx0]) resolvedChoice = String(page0.options[idx0])
  }
  // If we have a cached branch for this optionId, use it
  if (optionId) {
    const key = `${curIndex}:${optionId}`
    const cached = (story as any).branchCache?.[key]
    if (cached && cached.page) {
      // Commit without precompute; then adapt plan; then precompute using updated plan
      await commitPage(col, _id, doc, curIndex, cached, { precompute: false })
      const committedIndex = curIndex + 1
      // Mark plan as updating and adapt in background; return immediately
      await col.updateOne({ _id }, { $set: { planUpdating: true, updatedAt: new Date() } })
      ;(async () => {
        try {
          await adaptPlanAfterChoice(col, _id, doc, {
            pageIndex: committedIndex,
            choice: resolvedChoice,
            committedPage: cached.page,
          })
        } catch {
        } finally {
          // Clear planUpdating, then precompute with updated plan
          await col.updateOne(
            { _id },
            { $unset: { planUpdating: '' }, $set: { updatedAt: new Date() } },
          )
          precomputeNext(col, _id, committedIndex).catch(() => {})
          if (
            cached.page.optionIds &&
            cached.page.options &&
            cached.page.optionIds.length === cached.page.options.length
          ) {
            precomputeBranches(
              col,
              _id,
              committedIndex,
              cached.page.optionIds.map((id: string, i: number) => ({
                optionId: id,
                text: cached.page.options![i],
              })),
            ).catch(() => {})
          }
        }
      })().catch(() => {})
      return await col.findOne({ _id })
    }
  }
  // Fall back to text; if missing, try to map optionId to current page's text
  const choiceText = resolvedChoice
  if (!choiceText) throw new Error("Missing 'text' or valid 'optionId'")
  const gp = await generatePage(doc, {
    upToIndex: curIndex,
    optionBaseIndex: curIndex + 1,
    nextChoice: choiceText,
    allowOptions: Math.random() < 0.1,
  })
  // Commit without precompute first
  await commitPage(col, _id, doc, curIndex, gp, { precompute: false })
  const committedIndex = curIndex + 1
  // Mark plan as updating and adapt in background; return immediately
  await col.updateOne({ _id }, { $set: { planUpdating: true, updatedAt: new Date() } })
  ;(async () => {
    try {
      await adaptPlanAfterChoice(col, _id, doc, {
        pageIndex: committedIndex,
        choice: choiceText,
        committedPage: gp.page,
      })
    } catch {
    } finally {
      await col.updateOne(
        { _id },
        { $unset: { planUpdating: '' }, $set: { updatedAt: new Date() } },
      )
      precomputeNext(col, _id, committedIndex).catch(() => {})
      if (
        gp.page.optionIds &&
        gp.page.options &&
        gp.page.optionIds.length === gp.page.options.length
      ) {
        precomputeBranches(
          col,
          _id,
          committedIndex,
          gp.page.optionIds.map((id, i) => ({ optionId: id, text: gp.page.options![i] })),
        ).catch(() => {})
      }
    }
  })().catch(() => {})
  return await col.findOne({ _id })
}

// Ensure the default "Next" branch for a given index is precomputed in branchCache.
// This does not commit a new page; it only prepares `${index}:__next__` and returns once ready.
export async function ensureNextReady(bookId: string, index: number) {
  const col = await getBooksCollection()
  const _id = new ObjectId(bookId)
  const doc = (await col.findOne({ _id })) as WithId<BookDoc>
  // If a plan adaptation is in progress, defer generation; let callers report not-ready
  if ((doc as any)?.planUpdating === true) return
  const story = doc.story as any
  if (!story) throw new Error('Story not started')
  const maxIndex = (story.pages?.length ?? 0) - 1
  if (!Number.isInteger(index) || index < -1 || index > maxIndex)
    throw new Error(`Invalid index ${index}; must be between -1 and ${maxIndex}`)
  const key = `${index}:__next__`
  // Ensure maps exist if they were null
  if (!story.branchCache || typeof story.branchCache !== 'object') {
    await col.updateOne({ _id }, { $set: { 'story.branchCache': {}, updatedAt: new Date() } })
  }
  if (!story.branchPending || typeof story.branchPending !== 'object') {
    await col.updateOne({ _id }, { $set: { 'story.branchPending': {}, updatedAt: new Date() } })
  }
  // Quick check if already ready
  const freshA = (await col.findOne({ _id })) as WithId<BookDoc>
  const sA: any = freshA?.story || {}
  if (sA.branchCache?.[key]) {
    const at = sA.branchCacheAt?.[key] as any
    if (at) {
      const ts = new Date(at).getTime()
      const age = Date.now() - ts
      if (Number.isFinite(ts) && age > 120_000) {
        console.warn(
          `[NEXT READY] Outdated cache detected for ${key}; age=${age}ms. Clearing and regenerating...`,
        )
        await col.updateOne(
          { _id },
          {
            $unset: {
              [`story.branchCache.${key}`]: '',
              [`story.branchCacheAt.${key}`]: '',
            },
            $set: { updatedAt: new Date() },
          },
        )
      } else {
        return
      }
    } else {
      return
    }
  }
  // If a previous pending generation is stale (>2m), clear it so we can retry
  try {
    const pendA = sA.branchPending?.[key] as any
    if (pendA) {
      const pendTs = new Date(pendA).getTime()
      if (Number.isFinite(pendTs) && Date.now() - pendTs > 120_000) {
        console.warn(
          `[NEXT READY] Stale pending detected for ${key}; age=${Date.now() - pendTs}ms. Clearing to retry...`,
        )
        await col.updateOne({ _id, [`story.branchPending.${key}`]: new Date(pendTs) } as any, {
          $unset: { [`story.branchPending.${key}`]: '' },
          $set: { updatedAt: new Date() },
        })
      }
    }
  } catch {}
  // Try to claim pending slot atomically
  let weOwnClaim = false
  {
    const claim = await col.updateOne(
      {
        _id,
        [`story.branchCache.${key}`]: { $exists: false },
        [`story.branchPending.${key}`]: { $exists: false },
      } as any,
      { $set: { [`story.branchPending.${key}`]: new Date(), updatedAt: new Date() } },
    )
    weOwnClaim = claim.matchedCount > 0
  }
  if (!weOwnClaim) {
    // Someone else is generating; wait until done or try to take over if stale
    const deadline = Date.now() + 240_000
    console.log(`[NEXT READY] Waiting for pending generation for ${key} ...`)
    while (Date.now() < deadline) {
      const cur = (await col.findOne({ _id })) as WithId<BookDoc>
      const ss: any = cur?.story || {}
      if (ss.branchCache?.[key]) return
      const pend = ss.branchPending?.[key] as any
      if (pend) {
        const ts = new Date(pend).getTime()
        const age = Date.now() - ts
        if (Number.isFinite(ts) && age > 120_000) {
          // Attempt to take over by atomically replacing stale timestamp
          console.warn(`[NEXT READY] Taking over stale pending for ${key}; age=${age}ms`)
          const take = await col.updateOne(
            {
              _id,
              [`story.branchCache.${key}`]: { $exists: false },
              [`story.branchPending.${key}`]: new Date(ts),
            } as any,
            { $set: { [`story.branchPending.${key}`]: new Date(), updatedAt: new Date() } },
          )
          if (take.matchedCount > 0) {
            weOwnClaim = true
            break
          }
        }
      }
      await sleep(300)
    }
    if (!weOwnClaim) {
      console.error(`[NEXT READY] Timeout waiting for pending generation for ${key}`)
      throw new Error('Timeout waiting for pending generation')
    }
  }
  // We own the claim; generate
  try {
    console.log(`[NEXT READY] Generating ${key} ...`)
    const curDoc = (await col.findOne({ _id })) as WithId<BookDoc>
    await verifyPendingBeforeNext(col, _id, curDoc)
    const startedGen = Date.now()
    const gp = await generatePage(curDoc, {
      upToIndex: index,
      optionBaseIndex: index + 1,
      allowOptions: Math.random() < 0.1,
    })
    await col.updateOne(
      { _id },
      {
        $set: {
          [`story.branchCache.${key}`]: gp,
          [`story.branchCacheAt.${key}`]: new Date(),
          updatedAt: new Date(),
        },
        $unset: { [`story.branchPending.${key}`]: '' },
      },
    )
    console.log(`[NEXT READY] Generated ${key} in ${Date.now() - startedGen}ms`)
  } catch (e) {
    // Release claim on failure to allow retry
    await col.updateOne(
      { _id },
      { $unset: { [`story.branchPending.${key}`]: '' }, $set: { updatedAt: new Date() } },
    )
    console.error(`[NEXT READY] Generation failed for ${key}:`, (e as any)?.message || e)
    throw e
  }
}

export type StorySnapshot = {
  pages: StoryPage[]
  index: number
  notes: string[]
  summary: string
  turn: number
  // Debug-only: current plan cursor and full point/substep list
  debugPlan?: {
    curPoint: number
    curSub: number
    points: { title: string; brief: string; substeps?: string[] }[]
  } | null
}

export function toStorySnapshot(doc: WithId<BookDoc> | null): StorySnapshot | null {
  if (!doc?.story) return null
  const s = doc.story
  const plan = (doc as any).plan as StoryPlan | undefined
  let debugPlan: StorySnapshot['debugPlan'] = null
  if (plan && Array.isArray(plan.points)) {
    debugPlan = {
      curPoint: Number.isInteger(plan.curPoint) ? plan.curPoint : 0,
      curSub: Number.isInteger(plan.curSub) ? plan.curSub : 0,
      points: plan.points.map((p) => ({
        title: String((p as any)?.title ?? ''),
        brief: String((p as any)?.brief ?? ''),
        substeps: Array.isArray((p as any)?.substeps) ? ((p as any).substeps as string[]) : [],
      })),
    }
  }
  return {
    pages: s.pages ?? [],
    index: s.index ?? 0,
    notes: s.notes ?? [],
    summary: s.summary ?? '',
    turn: s.turn ?? 0,
    debugPlan,
  }
}

// Before generating the next page, verify any pending substep from the just-committed page.
async function verifyPendingBeforeNext(
  col: Collection<BookDoc>,
  _id: ObjectId,
  doc: WithId<BookDoc>,
) {
  try {
    const s: any = doc.story || {}
    const pv = s.pendingVerify
    if (!pv) return
    // Build context: last up to 3 pages (including current) and persistent notes
    const pages: any[] = Array.isArray(s.pages) ? s.pages : []
    const lastIdx = Number.isInteger(s.index) ? s.index : pages.length - 1
    const boundedLast = Math.max(0, Math.min(pages.length - 1, Number(lastIdx)))
    const start = Math.max(0, boundedLast - 3)
    const recent = pages
      .slice(start, boundedLast)
      .map((p) => String((p as any)?.passage || ''))
      .filter((t) => t.trim().length > 0)
    const notes: string[] = Array.isArray(s.notes) ? (s.notes as any[]).map((n) => String(n)) : []
    const done = await verifySubstep(pv.passage, pv.subText, { recent, notes })
    if (done) {
      await markSubstepDone(col, _id, doc, pv.pointIndex, pv.subIndex)
    }
    // Clear pending verification regardless, to avoid repeated attempts
    await col.updateOne({ _id }, { $set: { 'story.pendingVerify': null, updatedAt: new Date() } })
  } catch {
    // On any error, clear to avoid blocking future generations
    await col.updateOne({ _id }, { $set: { 'story.pendingVerify': null, updatedAt: new Date() } })
  }
}

// --- Branch caching helpers ---
async function pruneBranchCache(col: Collection<BookDoc>, _id: ObjectId) {
  const fresh = await col.findOne({ _id })
  const story = fresh?.story as any
  if (!story?.branchCache) return
  const idx = story.index ?? 0
  const toDelete: Record<string, ''> = {}
  for (const k of Object.keys(story.branchCache)) {
    const n = parseInt(k.split(':')[0] || '-1', 10)
    if (!Number.isFinite(n) || n > idx) {
      toDelete[`story.branchCache.${k}`] = ''
      toDelete[`story.branchCacheAt.${k}`] = ''
    }
  }
  if (Object.keys(toDelete).length) {
    await col.updateOne({ _id }, { $unset: toDelete, $set: { updatedAt: new Date() } })
  }
}

async function precomputeBranches(
  col: Collection<BookDoc>,
  _id: ObjectId,
  pageIndex: number,
  items: { optionId: string; text: string }[],
) {
  console.log('call precompute')
  try {
    // Refresh doc for generation context
    const doc = (await col.findOne({ _id })) as WithId<BookDoc>
    if (!doc?.story) return
    const tasks = items.map(async ({ optionId, text }) => {
      try {
        const key = `${pageIndex}:${optionId}`
        const staleBefore = new Date(Date.now() - 120_000)
        // Check for stale cache and log intent to refresh
        try {
          const check = (await col.findOne(
            { _id },
            { projection: { story: 1 } },
          )) as WithId<BookDoc>
          const at = (check as any)?.story?.branchCacheAt?.[key]
          if (at && new Date(at).getTime() <= staleBefore.getTime()) {
            console.warn(`[BRANCH PREC] Outdated cache detected for ${key}; refreshing...`)
          }
        } catch {}
        // Claim pending; skip if someone else is working or already ready
        const claim = await col.updateOne(
          {
            _id,
            [`story.branchPending.${key}`]: { $exists: false },
            $or: [
              { [`story.branchCache.${key}`]: { $exists: false } },
              { [`story.branchCacheAt.${key}`]: { $lte: staleBefore } },
            ],
          } as any,
          { $set: { [`story.branchPending.${key}`]: new Date(), updatedAt: new Date() } },
        )
        if (claim.matchedCount === 0) return
        console.log(`[BRANCH PREC] Generating ${key} ...`)
        const curDoc = (await col.findOne({ _id })) as WithId<BookDoc>
        await verifyPendingBeforeNext(col, _id, curDoc)
        const startedGen = Date.now()
        const gp = await generatePage(curDoc, {
          upToIndex: pageIndex,
          optionBaseIndex: pageIndex + 1,
          nextChoice: text,
          allowOptions: Math.random() < 0.1,
        })
        await col.updateOne(
          { _id },
          {
            $set: {
              [`story.branchCache.${key}`]: gp,
              [`story.branchCacheAt.${key}`]: new Date(),
              updatedAt: new Date(),
            },
            $unset: { [`story.branchPending.${key}`]: '' },
          },
        )
        console.log(`[BRANCH PREC] Generated ${key} in ${Date.now() - startedGen}ms`)
      } catch {}
    })
    await Promise.allSettled(tasks)
  } catch {}
}

// Fire-and-forget helper to ensure option branches at a given index are precomputed if missing or outdated
export async function ensureOptionsPrecompute(bookId: string, index: number) {
  console.log('ensureOptionsPrecompute')
  const col = await getBooksCollection()
  const _id = new ObjectId(bookId)
  const doc = (await col.findOne({ _id })) as WithId<BookDoc>
  const story: any = doc?.story
  if (!story) return
  const page = story?.pages?.[index]
  if (!page?.optionIds || !page?.options || page.optionIds.length !== page.options.length) return
  const staleBefore = new Date(Date.now() - 120_000)
  const optionsById = new Map<string, string>()
  for (const o of page.options) optionsById.set(o.id, o.text)
  const items: { optionId: string; text: string }[] = page.optionIds
    .map((oid: string) => ({ optionId: oid, text: optionsById.get(oid) as string }))
    .filter((x: { optionId: string; text: string }) => !!x.text)
  const missingOrStale = items.filter(({ optionId }: { optionId: string }) => {
    const key = `${index}:${optionId}`
    const has = !!story.branchCache?.[key]
    const at = story.branchCacheAt?.[key]
    if (!has) return true
    if (at && new Date(at).getTime() <= staleBefore.getTime()) return true
    return false
  })
  console.log('ensureOptionsPrecompute', missingOrStale.length)
  if (missingOrStale.length === 0) return
  // Kick off precompute without blocking the request
  // Errors are swallowed inside precomputeBranches; also guard here.
  precomputeBranches(col, _id, index, missingOrStale).catch(() => {})
}

async function precomputeNext(col: Collection<BookDoc>, _id: ObjectId, pageIndex: number) {
  try {
    // Refresh doc for generation context (includes the just-committed page)
    const doc = (await col.findOne({ _id })) as WithId<BookDoc>
    if (!doc?.story) return
    const key = `${pageIndex}:__next__`
    const staleBefore = new Date(Date.now() - 120_000)
    // If cache exists but is outdated, allow a refresh generation
    const claim = await col.updateOne(
      {
        _id,
        [`story.branchPending.${key}`]: { $exists: false },
        $or: [
          { [`story.branchCache.${key}`]: { $exists: false } },
          { [`story.branchCacheAt.${key}`]: { $lte: staleBefore } },
        ],
      } as any,
      { $set: { [`story.branchPending.${key}`]: new Date(), updatedAt: new Date() } },
    )
    if (claim.matchedCount === 0) return
    if ((doc as any)?.story?.branchCacheAt?.[key]) {
      const at = new Date((doc as any).story.branchCacheAt[key]).getTime()
      if (Number.isFinite(at) && at <= staleBefore.getTime()) {
        console.warn(`[NEXT PREC] Outdated cache detected for ${key}; refreshing...`)
      }
    }
    console.log(`[NEXT PREC] Generating ${key} ...`)
    await verifyPendingBeforeNext(col, _id, doc)
    const startedGen = Date.now()
    const gp = await generatePage(doc, {
      upToIndex: pageIndex,
      optionBaseIndex: pageIndex + 1,
      allowOptions: Math.random() < 0.1,
    })
    await col.updateOne(
      { _id },
      {
        $set: {
          [`story.branchCache.${key}`]: gp,
          [`story.branchCacheAt.${key}`]: new Date(),
          updatedAt: new Date(),
        },
        $unset: { [`story.branchPending.${key}`]: '' },
      },
    )
    console.log(`[NEXT PREC] Generated ${key} in ${Date.now() - startedGen}ms`)
  } catch {}
}
