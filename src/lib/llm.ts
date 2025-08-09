/*
  Simple OpenAI chat client using fetch.
  Reads configuration from Vite env variables:
    - VITE_OPENAI_API_KEY (required)
    - VITE_OPENAI_BASE_URL (optional, defaults to https://api.openai.com/v1)
    - VITE_OPENAI_MODEL (optional, defaults to 'gpt-4o-mini')
*/

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatOptions = {
  model?: string
  max_completion_tokens?: number
  response_format?: { type: 'json_object' | 'text' }
  reasoning_effort?: 'low' | 'medium' | 'high' | 'minimal'
  signal?: AbortSignal
}

export type ChatResponse = {
  content: string
  raw: any
}

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined
const BASE_URL =
  (import.meta.env.VITE_OPENAI_BASE_URL as string | undefined) ?? 'https://api.openai.com/v1'
const DEFAULT_MODEL = (import.meta.env.VITE_OPENAI_MODEL as string | undefined) ?? 'gpt-5'

function assertApiKey() {
  if (!API_KEY) {
    throw new Error('Missing VITE_OPENAI_API_KEY. Add it to your .env file.')
  }
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
  assertApiKey()

  const body: any = {
    model: opts.model ?? DEFAULT_MODEL,
    messages,
  }

  if (typeof opts.max_completion_tokens === 'number')
    body.max_completion_tokens = opts.max_completion_tokens
  if (opts.response_format) body.response_format = opts.response_format
  if (opts.reasoning_effort) body.reasoning_effort = opts.reasoning_effort

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  return { content, raw: data }
}

export function buildSystemPromptFromConfig(config: {
  world?: string
  inspirations?: string[]
  likedCharacters?: string[]
  genre?: string
  tone?: string
}): string {
  const parts: string[] = [
    'You are the narrative engine for a choose-your-own-adventure story. Generate vivid, concise prose.',
    'Always return exactly three next-action options: progress, unexpected, other. Keep options short.',
  ]
  if (config.world) parts.push(`World: ${config.world}`)
  if (config.inspirations?.length) parts.push(`Inspirations: ${config.inspirations.join(', ')}`)
  if (config.likedCharacters?.length)
    parts.push(`Liked characters: ${config.likedCharacters.join(', ')}`)
  if (config.genre) parts.push(`Genre: ${config.genre}`)
  if (config.tone) parts.push(`Tone: ${config.tone}`)
  return parts.join('\n')
}

// Planner-specific builder: no choice/option instructions; used for plan + substeps generation
export function buildPlannerSystemPromptFromConfig(config: {
  world?: string
  inspirations?: string[]
  likedCharacters?: string[]
  genre?: string
  tone?: string
}): string {
  const parts: string[] = [
    'You are a narrative planner. Design coherent story structure and guidance for an authoring system.',
  ]
  if (config.world) parts.push(`World: ${config.world}`)
  if (config.inspirations?.length) parts.push(`Inspirations: ${config.inspirations.join(', ')}`)
  if (config.likedCharacters?.length)
    parts.push(`Liked characters: ${config.likedCharacters.join(', ')}`)
  if (config.genre) parts.push(`Genre: ${config.genre}`)
  if (config.tone) parts.push(`Tone: ${config.tone}`)
  return parts.join('\n')
}
