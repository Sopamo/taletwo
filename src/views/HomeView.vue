<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useStoryStore } from '@/stores/story'

const router = useRouter()
const auth = useAuthStore()
const story = useStoryStore()

const books = ref<
  Array<{
    id: string
    world: string
    books: string[]
    mainCharacter: string
    genre: string
    createdAt?: string
    updatedAt?: string
  }>
>([])
const loading = ref(false)
const error = ref<string | null>(null)

const isLoggedIn = computed(() => !!auth.user)

async function loadBooks() {
  if (!isLoggedIn.value) return
  loading.value = true
  error.value = null
  try {
    const r = await fetch('/api/books', { headers: await auth.authHeaders() })
    if (!r.ok) throw new Error('Failed to load books')
    const j = await r.json()
    books.value = Array.isArray(j?.items) ? j.items : []
  } catch (e: any) {
    error.value = e?.message || 'Failed to load books'
  } finally {
    loading.value = false
  }
}

onMounted(loadBooks)
// If the user session hydrates after mount, load books when auth.user becomes available
watch(
  () => auth.user,
  (u: any) => {
    if (u && books.value.length === 0) loadBooks()
  },
  { immediate: false },
)

async function onLogin() {
  await auth.signInWithGoogle()
  await loadBooks()
}

async function onLogout() {
  await auth.signOut()
  books.value = []
}

async function onStartNew() {
  try {
    await story.createNewBook()
    router.push({ name: 'configure-guided' })
  } catch (e: any) {
    error.value = e?.message || 'Failed to start new book'
  }
}

async function onOpen(id: string) {
  try {
    await story.loadBook(id)
    router.push({ name: 'play', params: { bookId: id, index: 0 } })
  } catch (e: any) {
    error.value = e?.message || 'Failed to open book'
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl w-full px-4 py-8 space-y-6">
    <div class="flex items-center gap-2">
      <button
        @click="onStartNew"
        class="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-black font-medium"
      >
        Start new story
      </button>
    </div>

    <div>
      <h2 class="text-lg font-semibold mb-2">Your stories</h2>
      <div v-if="loading">Loading…</div>
      <div v-else-if="error" class="text-rose-400 text-sm">{{ error }}</div>
      <div v-else-if="!books.length" class="text-slate-400 text-sm">
        You dont have any stories yet.
      </div>
      <div v-else class="grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 gap-4">
        <button
          v-for="b in books"
          :key="b.id"
          @click="onOpen(b.id)"
          class="text-left rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-900 p-4 transition focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="font-semibold text-white truncate">{{ b.world || 'Untitled world' }}</div>
            <svg
              class="w-4 h-4 text-slate-400 group-hover:text-slate-300"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
          <div class="mt-2 text-sm text-slate-300">{{ (b.books || []).join(', ') || '—' }}</div>
          <div class="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <span>{{ b.mainCharacter || '—' }}</span>
            <span>•</span>
            <span>{{ b.genre || '—' }}</span>
          </div>
        </button>
      </div>
    </div>
    <div v-if="auth.loading">Checking login…</div>

    <div v-else-if="!isLoggedIn" class="space-y-3">
      <p>Sign in with Google to start creating and playing your stories.</p>
      <button
        @click="onLogin"
        class="px-4 py-2 rounded-md bg-white text-black font-semibold hover:bg-slate-200"
      >
        Sign in with Google
      </button>
    </div>

    <div v-else class="space-y-6">
      <div class="flex items-center justify-between">
        <div class="text-sm text-slate-300">
          Logged in as
          <span class="font-medium text-white">{{
            auth.user?.displayName || auth.user?.email
          }}</span>
        </div>
        <button
          @click="onLogout"
          class="px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800"
        >
          Sign out
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
