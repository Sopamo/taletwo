import type { BookDoc, ConfigFieldId, ChatMessage } from '../types'

type Suggestions = { question: string; options: string[] }

// Generic Chat API wrapper used by story planning/generation
export type ChatOptions = {
  model?: string
  response_format?: any
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high'
  max_completion_tokens?: number
  tag?: string
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<{ content: string }> {
  const key = getApiKey()
  const body: any = {
    model: opts.model ?? MODEL,
    messages,
  }
  if (opts.response_format) body.response_format = opts.response_format
  // Default reasoning effort to 'low' if not specified
  if (opts.model !== 'gpt-5-chat-latest') body.reasoning_effort = opts.reasoning_effort ?? 'low'
  if (typeof opts.max_completion_tokens === 'number')
    body.max_completion_tokens = opts.max_completion_tokens

  // Prompt body logging to file disabled; using stdout timing only.

  const started = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
    const ms = Date.now() - started
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(
        `[LLM ERROR] tag=${opts.tag ?? 'chat'} model=${body.model} ms=${ms} status=${res.status} reason=${(text || '').slice(0, 200)}`,
      )
      throw new Error(`LLM error ${res.status}: ${text}`)
    }
    const data = await res.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const systemChars = messages
      .filter((m) => m.role === 'system')
      .map((m) => String((m as any).content ?? '').length)
      .reduce((a, b) => a + b, 0)
    const userChars = messages
      .filter((m) => m.role === 'user')
      .map((m) => String((m as any).content ?? '').length)
      .reduce((a, b) => a + b, 0)
    console.log(
      `[LLM] tag=${opts.tag ?? 'chat'} model=${body.model} ms=${ms} rf=${
        body.response_format ? 'json' : 'none'
      } re=${body.reasoning_effort ?? 'low'} maxTok=${
        body.max_completion_tokens ?? 'n/a'
      } sizes=(${systemChars},${userChars},${(content ?? '').length})`,
    )
    return { content }
  } catch (e: any) {
    const ms = Date.now() - started
    console.error(
      `[LLM EXC] tag=${opts.tag ?? 'chat'} model=${body.model} ms=${ms} err=${
        e?.message || String(e)
      }`,
    )
    throw e
  }
}

// Prompt builders for planner and story generator
type Cfg = { books?: string[]; world?: string; mainCharacter?: string; genre?: string }

export function buildPlannerSystemPromptFromConfig(cfg: Cfg): string {
  const parts: string[] = []
  if (cfg.books?.length)
    parts.push(`Blend influences from these two books: ${cfg.books.join(' + ')}`)
  if (cfg.world) parts.push(`World/Setting: ${cfg.world}`)
  if (cfg.mainCharacter) parts.push(`Main Character: ${cfg.mainCharacter}`)
  if (cfg.genre) parts.push(`Genre: ${cfg.genre}`)
  parts.push(
    'You are a planning assistant for a branching narrative game. Think clearly about theme and conflict and outline a plausible progression without mentioning choices. Be concise and concrete.',
  )
  return parts.join('\n')
}

export function buildSystemPromptFromConfig(cfg: Cfg): string {
  const parts: string[] = []
  parts.push(
    'You are an expert narrative engine for an interactive story. Maintain tight continuity and concrete, readable prose.',
  )
  if (cfg.books?.length) parts.push(`Tone/Influence blend: ${cfg.books.join(' + ')}`)
  if (cfg.world) parts.push(`Setting: ${cfg.world}`)
  if (cfg.mainCharacter) parts.push(`Protagonist: ${cfg.mainCharacter}`)
  if (cfg.genre) parts.push(`Genre: ${cfg.genre}`)
  parts.push(
    'Avoid meta commentary. Never reveal internal planning. Make this story easy to read. Progress the scene naturally each turn.',
  )
  // Global style guidance to keep prose lean and reduce overuse of figurative comparisons
  parts.push(
    'Style: Write lean, concrete prose. Prefer plain, contemporary diction; concrete nouns and active verbs.',
  )
  parts.push(
    'Sentence architecture: Mostly simple declaratives (avg 12–18 words); avoid semicolons; em dashes sparingly; at most one subordinate clause.',
  )
  parts.push(
    'Figurative discipline: Use at most one fresh, in-world metaphor or simile per page, only if it clarifies mood or action. Do not stack or extend a metaphor. Avoid cosmic/abstract analogies.',
  )
  parts.push(
    'POV integrity: Any image must be something the viewpoint character would plausibly think or notice.',
  )
  parts.push(
    'Literal-first: Prefer literal sensory description and specific action beats; reach for comparison only when it makes the moment clearer.',
  )
  parts.push(
    'Self-edit: Remove mixed/cliché metaphors and decorative modifiers that do not carry weight; prefer literal rephrasings.',
  )
  return parts.join('\n')
}

const BASE_URL = Bun.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const MODEL = Bun.env.OPENAI_MODEL ?? 'gpt-5'

function getApiKey() {
  const key = Bun.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY')
  return key
}

export async function getConfigSuggestions(
  context: Partial<BookDoc>,
  setting: ConfigFieldId,
): Promise<Suggestions> {
  const key = getApiKey()

  // Build a system prompt, with extra constraints for the "Books" field to ensure public-domain suggestions
  let sysContent =
    'You are helping a user configure a choose-your-own-adventure story. For the requested field, return a JSON object with fields: {"question": string, "options": [string, string, string]}. The question should politely ask the user for that field, and each option should be short, vivid, and distinct. Respond STRICTLY with JSON and nothing else.'
  if (setting === 'books') {
    sysContent +=
      '\n\nWhen the requested field is "Books":\n- Only suggest well-known, commonly recognized public-domain books (US public domain; typically published before 1929).\n- Each option must contain exactly two such titles, comma-separated (e.g., "Pride and Prejudice, Moby-Dick").\n- Use exact canonical English titles.\n- Do NOT include modern copyrighted franchises (e.g., Harry Potter, The Hunger Games, The Hobbit, The Lord of the Rings, Dune, etc.).'
  }
  const sys = {
    role: 'system',
    content: sysContent,
  }

  const labelMap: Record<ConfigFieldId, string> = {
    books: 'Books',
    world: 'World',
    mainCharacter: 'Main Character',
    genre: 'Genre',
  }

  const hintMap: Record<ConfigFieldId, string> = {
    books:
      'Enter exactly two well-known public-domain books (comma-separated). Public-domain only (commonly known classics; typically published before 1929). Use exact titles.',
    world: 'One or two sentences describing the setting, era, vibe, conflicts.',
    mainCharacter: 'Who is the protagonist? A name and a word or two describing them is fine.',
    genre: 'One short genre, e.g. fantasy, sci-fi, mystery, etc.',
  }

  const usr = {
    role: 'user',
    content: `Current config (may be partial):\n${JSON.stringify({
      books: context.books?.length ? context.books : undefined,
      world: context.world || undefined,
      mainCharacter: context.mainCharacter || undefined,
      genre: context.genre || undefined,
    })}\n\nField to suggest: ${labelMap[setting]}\nHint: ${hintMap[setting]}\nReturn exactly three options in JSON as described.`,
  }
  const model = 'gpt-5-nano'
  const body: any = {
    model,
    reasoning_effort: 'minimal',
    messages: [sys, usr],
    response_format: { type: 'json_object' },
  }

  // Prompt body logging disabled; using stdout timing only.

  const started = Date.now()
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - started

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(
      `[LLM SUGG ERROR] model=${model} ms=${ms} status=${res.status} reason=${(text || '').slice(
        0,
        200,
      )}`,
    )
    throw new Error(`LLM error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const sysChars = (sys.content ?? '').length
  const usrChars = (usr.content ?? '').length
  console.log(
    `[LLM SUGG] model=${model} ms=${ms} sizes=(${sysChars},${usrChars},${(content ?? '').length})`,
  )
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw new Error('Model did not return valid JSON. Content: ' + content?.slice(0, 200))
  }

  const q = (parsed?.question ?? '').toString()
  let opts = Array.isArray(parsed?.options)
    ? parsed.options.map((x: any) => String(x)).slice(0, 3)
    : []
  if (!q || opts.length !== 3)
    throw new Error('Missing question or exactly three options in response')

  // Extra validation for 'books': ensure options are two well-known public-domain titles
  if (setting === 'books') {
    const PD_TITLES = new Set(
      [
        'pride and prejudice',
        'moby-dick',
        'moby dick',
        'frankenstein',
        'dracula',
        "alice's adventures in wonderland",
        'the time machine',
        'the war of the worlds',
        'the picture of dorian gray',
        'a study in scarlet',
        'the adventures of sherlock holmes',
        'journey to the center of the earth',
        'twenty thousand leagues under the seas',
        "gulliver's travels",
        'don quixote',
        'the three musketeers',
        'the count of monte cristo',
        'treasure island',
        'robinson crusoe',
        'the strange case of dr. jekyll and mr. hyde',
        'wuthering heights',
        'jane eyre',
        'great expectations',
        'a tale of two cities',
        'les miserables',
        'anna karenina',
        'crime and punishment',
        'the romance of the three kingdoms',
        'the odyssey',
        'the iliad',
      ].map((s) => s.toLowerCase()),
    )
    const BANNED = new Set(
      [
        'harry potter',
        'the hunger games',
        'the hobbit',
        'the lord of the rings',
        'dune',
        'mistborn',
        'the grey man',
      ].map((s) => s.toLowerCase()),
    )
    const DEFAULTS = [
      'Pride and Prejudice, Moby-Dick',
      'Frankenstein, Dracula',
      "Alice's Adventures in Wonderland, The Time Machine",
    ]
    const isValidCombo = (s: string) => {
      const parts = s.split(',').map((t) => t.trim())
      if (parts.length !== 2 || !parts[0] || !parts[1]) return false
      const [a, b] = parts
      const al = a.toLowerCase()
      const bl = b.toLowerCase()
      if (BANNED.has(al) || BANNED.has(bl)) return false
      return PD_TITLES.has(al) && PD_TITLES.has(bl)
    }
    // Repair invalid suggestions by replacing them with safe defaults
    const used = new Set<string>()
    opts = opts.map((o: string) => {
      if (isValidCombo(o)) {
        used.add(o.toLowerCase())
        return o
      }
      // find a default not yet used
      const replacement = DEFAULTS.find((d) => !used.has(d.toLowerCase())) || DEFAULTS[0]
      used.add(replacement.toLowerCase())
      return replacement
    })
  }

  return { question: q, options: opts }
}
