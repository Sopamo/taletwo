/*
  Simple OpenAI chat client using fetch.
  Configuration:
    - OpenAI API key: stored in localStorage via `getApiKey()` from `@/lib/apiKey`.
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

import { getApiKey } from '@/lib/apiKey'
const BASE_URL =
  (import.meta.env.VITE_OPENAI_BASE_URL as string | undefined) ?? 'https://api.openai.com/v1'
const DEFAULT_MODEL = (import.meta.env.VITE_OPENAI_MODEL as string | undefined) ?? 'gpt-5'

function assertApiKey() {
  const key = getApiKey()
  if (!key) {
    throw new Error('Missing OpenAI API key. Please enter it on the Taletwo screen.')
  }
}

// Lightweight API key validation: calls the Models list endpoint, which does not consume tokens.
export async function checkApiKeyValid(key: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE_URL}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    signal,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error?.message || JSON.stringify(data)
    } catch {
      try {
        detail = await res.text()
      } catch {}
    }
    const msg = detail ? `OpenAI key validation failed (${res.status}): ${detail}` : `OpenAI key validation failed (${res.status}).`
    throw new Error(msg)
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

  const apiKey = getApiKey()!
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
  books?: string[]
  world?: string
  mainCharacter?: string
  genre?: string
}): string {
  const parts: string[] = [
    'You are the narrative engine for a choose-your-own-adventure story. Generate vivid, concise prose.',
    'Always return exactly three next-action options: progress, unexpected, other. Keep options short.',
  ]
  if (config.books?.length) parts.push(`Books to blend: ${config.books.join(', ')}`)
  if (config.world) parts.push(`World: ${config.world}`)
  if (config.mainCharacter) parts.push(`Main character: ${config.mainCharacter}`)
  if (config.genre) parts.push(`Genre: ${config.genre}`)
  return parts.join('\n')
}

// Planner-specific builder: no choice/option instructions; used for plan + substeps generation
export function buildPlannerSystemPromptFromConfig(config: {
  books?: string[]
  world?: string
  mainCharacter?: string
  genre?: string
}): string {
  const parts: string[] = [
    'You are a narrative planner. Design coherent story structure and guidance for an authoring system.',
  ]
  if (config.books?.length) parts.push(`Books to blend: ${config.books.join(', ')}`)
  if (config.world) parts.push(`World: ${config.world}`)
  if (config.mainCharacter) parts.push(`Main character: ${config.mainCharacter}`)
  if (config.genre) parts.push(`Genre: ${config.genre}`)
  return parts.join('\n')
}
