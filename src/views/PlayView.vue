<script setup lang="ts">
import { onMounted, watch, nextTick, computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import StoryRenderer from '@/components/StoryRenderer.vue'
import ChoicesList from '@/components/ChoicesList.vue'
import { useStoryStore } from '@/stores/story'

const store = useStoryStore()
const route = useRoute()
const router = useRouter()

const allOptionsReady = computed(() => {
  const cp = store.currentPage
  const ids = cp?.optionIds ?? []
  const hasChoices = (cp?.options?.length ?? 0) === 3
  if (!hasChoices || ids.length !== 3) return false
  return ids.every((oid) => !!store.optionsReady[oid])
})

onMounted(async () => {
  const rawId = route.params.bookId
  const rawIdx = route.params.index
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : ''
  const idxNum = Number.parseInt(
    typeof rawIdx === 'string' ? rawIdx : Array.isArray(rawIdx) ? rawIdx[0] : '0',
    10,
  )
  if (id) {
    await store.loadBook(id)
    store.setIndex(Number.isFinite(idxNum) ? idxNum : 0)
  } else {
    // Fallback: ensure a book exists then normalize URL
    await store.startIfNeeded()
    const ensuredId = await store.ensureBook()
    router.replace({ name: 'play', params: { bookId: ensuredId, index: store.index } })
  }
})

// When switching pages, scroll to the very top so the reader starts at the beginning
watch(
  () => store.index,
  async () => {
    await nextTick()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  },
)

// Keep route -> state in sync (browser back/forward or manual edits)
watch(
  () => [route.params.bookId, route.params.index],
  async ([bid, idx]) => {
    const id = typeof bid === 'string' ? bid : Array.isArray(bid) ? bid[0] : ''
    const idxNum = Number.parseInt(
      typeof idx === 'string' ? idx : Array.isArray(idx) ? idx[0] : '0',
      10,
    )
    if (id && id !== store.bookId) {
      await store.loadBook(id)
    }
    if (Number.isFinite(idxNum) && idxNum !== store.index) {
      store.setIndex(idxNum)
    }
  },
)

// Keep state -> route in sync (Next/Prev/Choose)
watch(
  () => [store.bookId, store.index],
  ([bid, idx]) => {
    const id = bid || ''
    if (!id) return
    const curId = typeof route.params.bookId === 'string' ? route.params.bookId : ''
    const curIdx = Number.parseInt(
      typeof route.params.index === 'string' ? route.params.index : '0',
      10,
    )
    if (id !== curId || idx !== curIdx) {
      // push to create proper history for back/forward
      router.push({ name: 'play', params: { bookId: id, index: idx } })
    }
  },
)

function onSelectChoice(choice: string) {
  // choice is a plain string option as returned by the LLM
  store.chooseSuggestion(choice)
}

function onPrev() {
  store.goPrev()
}

function onNext() {
  store.goNext()
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0">
    <!-- Slim top bar with back chevron -->
    <div class="h-10 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur flex items-center">
      <div class="mx-auto w-full max-w-3xl px-4">
        <RouterLink
          :to="{ name: 'home' }"
          class="inline-flex items-center text-slate-300 hover:text-slate-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-5 h-5"
          >
            <path
              fill-rule="evenodd"
              d="M15.53 4.47a.75.75 0 0 1 0 1.06L9.06 12l6.47 6.47a.75.75 0 1 1-1.06 1.06l-7-7a.75.75 0 0 1 0-1.06l7-7a.75.75 0 0 1 1.06 0Z"
              clip-rule="evenodd"
            />
          </svg>
        </RouterLink>
      </div>
    </div>

    <!-- Main content fills remaining space -->
    <main class="mx-auto w-full max-w-3xl flex-1 flex flex-col min-h-0 px-4 py-3 gap-3">
      <StoryRenderer :text="store.currentPage?.passage || ''" />

      <div v-if="store.error" class="text-rose-400 text-sm">{{ store.error }}</div>
      <div v-else-if="store.loading" class="text-slate-400 text-sm">Thinking…</div>

      <div class="sticky bottom-0 border-t border-slate-800/80 bg-slate-950/85 backdrop-blur -mx-4">
        <div class="mx-auto max-w-3xl px-4 py-3 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <button
              class="px-3 py-1.5 rounded bg-slate-800 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700"
              :disabled="!store.canGoPrev || store.loading"
              @click="onPrev"
            >
              ← Previous
            </button>
            <div class="text-xs text-slate-400">
              Page {{ store.index + 1 }} / {{ Math.max(store.pages.length, 1) }}
            </div>
            <div class="inline-flex items-center gap-2">
              <button
                class="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500"
                :disabled="
                  !store.canGoNext ||
                  store.loading ||
                  (store.index === store.pages.length - 1 && !store.nextReady)
                "
                @click="onNext"
              >
                Next →
              </button>
            </div>
          </div>
          <ChoicesList
            v-if="store.index === store.pages.length - 1 && store.currentOptions.length === 3 && store.hasBranchPrefetchForCurrent"
            :choices="store.currentOptions"
            :disabled="store.loading || !allOptionsReady"
            :option-ids="store.currentPage?.optionIds || []"
            :ready-by-id="store.optionsReady"
            @select="onSelectChoice"
          />
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped></style>
