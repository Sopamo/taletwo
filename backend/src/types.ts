import type { ObjectId } from 'mongodb'

export type ConfigFieldId = 'books' | 'world' | 'mainCharacter' | 'genre'

export type ChatRole = 'system' | 'user' | 'assistant'
export type ChatMessage = {
  role: ChatRole
  content: string
}

export type StoryPage = {
  passage: string
  summary: string
  options?: string[]
  optionIds?: string[]
  // When true, a choice was selected on this page; frontend should not show choice buttons for this page.
  choiceMade?: boolean
}

export type StoryPoint = {
  title: string
  brief: string
  substeps?: string[]
}

export type StoryPlan = {
  overallIdea: string
  conflict: string
  points: StoryPoint[]
  curPoint: number
  curSub: number
}

export type StoryState = {
  pages: StoryPage[]
  index: number
  notes: string[]
  summary: string
  turn: number
  // Cache for precomputed next pages for choices on a given page.
  // Keys are of the form `${pageIndex}:${optionId}` and values store a generated page payload.
  // We intentionally keep this out of public snapshots.
  branchCache?: Record<string, any>
  // Pending flags for in-flight generation to avoid duplicate work.
  // Keys mirror branchCache keys; values are timestamps.
  branchPending?: Record<string, any>
  // When set, a verification should be performed before generating the next page.
  // This allows us to avoid blocking the choose request on verification.
  pendingVerify?: {
    passage: string
    subText: string
    pointIndex: number
    subIndex: number
  } | null
}

export type BookDoc = {
  _id?: ObjectId
  // Owner user id (Firebase Auth UID)
  userId: string
  world: string
  books: string[]
  mainCharacter: string
  genre: string
  createdAt: Date
  updatedAt: Date
  plan?: StoryPlan
  story?: StoryState
  // When true, the backend is adapting the plan after a choice; defer next-page generation.
  planUpdating?: boolean
}
