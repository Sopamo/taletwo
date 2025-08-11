// Bun + TypeScript minimal HTTP server
import { ObjectId } from 'mongodb'
import { getBooksCollection } from './lib/db'
import { getConfigSuggestions } from './lib/llm'
import {
  chooseStory,
  nextStory,
  startStory,
  toStorySnapshot,
  ensureNextReady,
  ensureOptionsPrecompute,
} from './lib/story'
import type { BookDoc, ConfigFieldId } from './types'
import { requireAuth } from './lib/auth'

const port = Number(Bun.env.PORT ?? 3000)

const CORS_ORIGIN = Bun.env.CORS_ORIGIN ?? '*'
const baseHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data: any, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...baseHeaders },
    ...init,
  })
}

async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function notFound(msg = 'Not Found') {
  return json({ error: msg }, { status: 404 })
}

function badRequest(msg = 'Bad Request') {
  return json({ error: msg }, { status: 400 })
}

function unauthorized(msg = 'Unauthorized') {
  return json({ error: msg }, { status: 401 })
}

function forbidden(msg = 'Forbidden') {
  return json({ error: msg }, { status: 403 })
}

function toObjectId(id: string): ObjectId | null {
  try {
    return new ObjectId(id)
  } catch {
    return null
  }
}

const server = Bun.serve({
  port,
  // Increase default 10s idle timeout; LLM calls can take longer
  idleTimeout: 255,
  async fetch(req: Request) {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method.toUpperCase()

    // Preflight CORS
    if (method === 'OPTIONS') {
      return new Response(null, { headers: baseHeaders })
    }

    // Health check
    if (path === '/health') return new Response('ok', { status: 200 })

    // Greeting
    if (path === '/api/hello' && method === 'GET') {
      return json({
        message: 'Hello from TaleTwo backend (Bun)',
        time: new Date().toISOString(),
      })
    }

    // POST /api/books — start a new book (auth required)
    if (path === '/api/books' && method === 'POST') {
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const now = new Date()
      const doc: BookDoc = {
        userId: user.uid,
        world: '',
        books: [],
        mainCharacter: '',
        genre: '',
        createdAt: now,
        updatedAt: now,
      }
      const col = await getBooksCollection()
      const res = await col.insertOne(doc)
      return json({ id: res.insertedId.toHexString() }, { status: 201 })
    }

    // GET /api/books — list current user's books (auth required)
    if (path === '/api/books' && method === 'GET') {
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const col = await getBooksCollection()
      const cursor = col.find({ userId: user.uid })
      const items = await cursor
        .map(({ _id, world, books, mainCharacter, genre, createdAt, updatedAt }) => ({
          id: _id!.toHexString(),
          world,
          books,
          mainCharacter,
          genre,
          createdAt,
          updatedAt,
        }))
        .toArray()
      return json({ items })
    }

    // GET /api/books/:id — fetch a book (auth + ownership)
    if (method === 'GET' && path.startsWith('/api/books/') && path.split('/').length === 4) {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const col = await getBooksCollection()
      const doc = await col.findOne({ _id, userId: user.uid })
      if (!doc) return notFound('Book not found')
      const { _id: oid, ...rest } = doc
      return json({ id: oid.toHexString(), ...rest })
    }

    // GET /api/books/:id/story — get story snapshot (auth + ownership; auto-generate first page if empty)
    if (path.endsWith('/story') && method === 'GET') {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const col = await getBooksCollection()
      const doc = await col.findOne({ _id, userId: user.uid })
      if (!doc) return notFound('Book not found')
      const hasPages = !!(doc.story && Array.isArray(doc.story.pages) && doc.story.pages.length > 0)
      if (!hasPages) {
        try {
          const doc2 = await startStory(id)
          const snap2 = toStorySnapshot(doc2 as any)
          return json({ id, story: snap2 })
        } catch (e: any) {
          return json({ error: e?.message || 'Failed to start story' }, { status: 500 })
        }
      }
      const snap = toStorySnapshot(doc as any)
      return json({ id, story: snap })
    }

    // POST /api/books/:id/story/start — initialize and generate first page (auth + ownership)
    if (path.endsWith('/story/start') && method === 'POST') {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const col = await getBooksCollection()
      const doc0 = await col.findOne({ _id, userId: user.uid })
      if (!doc0) return notFound('Book not found')
      try {
        const doc = await startStory(id)
        const snap = toStorySnapshot(doc as any)
        return json({ id, story: snap })
      } catch (e: any) {
        return json({ error: e?.message || 'Failed to start story' }, { status: 500 })
      }
    }

    // GET /api/books/:id/story/ready?index=NUM — readiness of next and option branches for a specific index. (auth + ownership)
    // If the default next branch is not ready, this endpoint will generate it and only return once ready.
    if (path.endsWith('/story/ready') && method === 'GET') {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const indexParam = url.searchParams.get('index')
      if (indexParam === null) return badRequest("Missing 'index' query param")
      const index = Number.parseInt(indexParam, 10)
      if (!Number.isFinite(index)) return badRequest("Query param 'index' must be an integer")
      const col = await getBooksCollection()
      let doc: any = await col.findOne({ _id, userId: user.uid })
      if (!doc?.story) return json({ id, ready: { next: false, options: {} } })
      let story = doc.story as any
      const maxIndex = (story.pages?.length ?? 0) - 1
      if (index < -1 || index > maxIndex)
        return badRequest(`'index' must be between -1 and ${maxIndex}`)
      const nextKey = `${index}:__next__`
      if (!(story.branchCache?.[nextKey])) {
        try {
          // Generate and store the default next continuation for this index; blocks until done
          await ensureNextReady(id, index)
          // Refresh after generation
          doc = await col.findOne({ _id })
          story = doc?.story as any
        } catch (e: any) {
          return json({ error: e?.message || 'Failed to prepare readiness' }, { status: 500 })
        }
      }
      // Kick off background precompute for missing/outdated option branches at this index
      ensureOptionsPrecompute(id, index).catch(() => {})
      const branchCache = story?.branchCache || {}
      const options: Record<string, boolean> = {}
      const page = story?.pages?.[index]
      if (page?.optionIds && page?.options && page.optionIds.length === page.options.length) {
        for (const oid of page.optionIds) {
          const key = `${index}:${oid}`
          options[oid] = !!branchCache[key]
        }
      }
      return json({ id, ready: { next: !!branchCache[nextKey], options } })
    }

    // POST /api/books/:id/story/next — advance story one turn (no choice). Body: { index: number } (auth + ownership)
    if (path.endsWith('/story/next') && method === 'POST') {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      type Body = { index: number }
      let body: Body
      try {
        body = await readJson<Body>(req)
      } catch (e: any) {
        return badRequest(e?.message || 'Invalid JSON body')
      }
      const index = Number(body?.index)
      if (!Number.isInteger(index)) return badRequest("'index' must be an integer")
      const col = await getBooksCollection()
      const doc0 = await col.findOne({ _id, userId: user.uid })
      if (!doc0) return notFound('Book not found')
      try {
        const doc = await nextStory(id, index)
        const snap = toStorySnapshot(doc as any)
        return json({ id, story: snap })
      } catch (e: any) {
        return json({ error: e?.message || 'Failed to advance story' }, { status: 500 })
      }
    }

    // POST /api/books/:id/story/choose — apply a user choice from a specific index. Body: { index: number, optionId?: string, text?: string } (auth + ownership)
    if (path.endsWith('/story/choose') && method === 'POST') {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      type Body = { index: number; optionId?: string; text?: string }
      let body: Body
      try {
        body = await readJson<Body>(req)
      } catch (e: any) {
        return badRequest(e?.message || 'Invalid JSON body')
      }
      const index = Number(body?.index)
      if (!Number.isInteger(index)) return badRequest("'index' must be an integer")
      const hasOptionId = typeof body?.optionId === 'string' && body.optionId.trim().length > 0
      const hasText = typeof body?.text === 'string' && body.text.trim().length > 0
      if (!hasOptionId && !hasText) return badRequest("Missing 'text' or 'optionId'")
      const col = await getBooksCollection()
      const doc0 = await col.findOne({ _id, userId: user.uid })
      if (!doc0) return notFound('Book not found')
      try {
        const doc2 = await chooseStory(id, { index, optionId: body.optionId, text: body.text })
        const snap = toStorySnapshot(doc2 as any)
        return json({ id, story: snap })
      } catch (e: any) {
        return json({ error: e?.message || 'Failed to apply choice' }, { status: 500 })
      }
    }

    // GET /api/books/:id/config?s=setting — suggest options via LLM (auth + ownership)
    if (path.endsWith('/config') && method === 'GET') {
      const id = path.split('/')[3]
      const setting = (url.searchParams.get('s') || '').trim() as ConfigFieldId
      if (!setting || !['books', 'world', 'mainCharacter', 'genre'].includes(setting))
        return badRequest("Query param 's' must be one of books, world, mainCharacter, genre")

      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      const col = await getBooksCollection()
      const doc = await col.findOne({ _id, userId: user.uid })
      if (!doc) return notFound('Book not found')

      try {
        const suggestions = await getConfigSuggestions(
          {
            books: doc.books?.length ? doc.books : undefined,
            world: doc.world || undefined,
            mainCharacter: doc.mainCharacter || undefined,
            genre: doc.genre || undefined,
          },
          setting,
        )
        return json(suggestions)
      } catch (e: any) {
        return json({ error: e?.message || 'Failed to get suggestions' }, { status: 502 })
      }
    }

    // POST /api/books/:id/config — set a single config field (auth + ownership)
    if (path.endsWith('/config') && method === 'POST') {
      const id = path.split('/')[3]
      const _id = toObjectId(id)
      if (!_id) return badRequest('Invalid book id')
      let user
      try {
        user = await requireAuth(req)
      } catch {
        return unauthorized('Missing or invalid auth token')
      }
      type Body = { setting: ConfigFieldId; value: string | string[] }
      let body: Body
      try {
        body = await readJson<Body>(req)
      } catch (e: any) {
        return badRequest(e?.message || 'Invalid JSON body')
      }

      const { setting, value } = body ?? ({} as Body)
      if (!setting || !['books', 'world', 'mainCharacter', 'genre'].includes(setting))
        return badRequest("'setting' must be one of books, world, mainCharacter, genre")

      let update: Partial<BookDoc> = {}
      if (setting === 'books') {
        let arr: string[]
        if (Array.isArray(value)) arr = value
        else
          arr = String(value || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        update.books = arr
      } else if (setting === 'world') update.world = String(value ?? '')
      else if (setting === 'mainCharacter') update.mainCharacter = String(value ?? '')
      else if (setting === 'genre') update.genre = String(value ?? '')

      const col = await getBooksCollection()
      await col.updateOne({ _id, userId: user.uid }, { $set: { ...update, updatedAt: new Date() } })
      const doc = await col.findOne({ _id, userId: user.uid })
      if (!doc) return notFound('Book not found')
      const { _id: oid, ...rest } = doc
      return json({ id: oid.toHexString(), ...rest })
    }

    return notFound()
  },
})

console.log(`Backend listening on http://localhost:${server.port}`)
