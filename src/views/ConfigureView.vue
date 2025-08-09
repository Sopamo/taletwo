<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useStoryConfigStore } from '@/stores/storyConfig'

const router = useRouter()
const cfg = useStoryConfigStore()

// Local editable fields
const world = ref(cfg.world)
const booksText = ref((cfg.books || []).join(', '))
const mainCharacter = ref(cfg.mainCharacter)
const genre = ref(cfg.genre)

function parseCSV(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function save() {
  cfg.setAll({
    world: world.value,
    books: parseCSV(booksText.value),
    mainCharacter: mainCharacter.value,
    genre: genre.value,
  })
}

function start() {
  save()
  if (cfg.isComplete) {
    router.push({ name: 'plan-loading' })
  }
}

// keep store in sync if user types and navigates away accidentally
watch([world, booksText, mainCharacter, genre], save)

const canContinue = computed(() => {
  return (
    world.value.trim().length > 0 &&
    parseCSV(booksText.value).length >= 2 &&
    mainCharacter.value.trim().length > 0 &&
    genre.value.trim().length > 0
  )
})
</script>

<template>
  <div class="mx-auto max-w-3xl w-full px-4 py-6">
    <h2 class="text-2xl font-semibold tracking-tight mb-2">Configure your story</h2>
    <p class="text-sm text-slate-400 mb-6">Set the world, two books to blend, a main character, and a genre. These are persisted locally.</p>

    <div class="space-y-5">
      <div>
        <label class="block text-sm font-medium mb-1">World</label>
        <textarea v-model="world" rows="3" class="w-full rounded-md bg-slate-900 border border-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-600"></textarea>
        <p class="text-xs text-slate-500 mt-1">Describe the setting, era, magic/tech level, conflicts.</p>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Books (comma separated, exactly two)</label>
        <input v-model="booksText" class="w-full rounded-md bg-slate-900 border border-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-600" />
        <p class="text-xs text-slate-500 mt-1">Enter two books you love and want to blend.</p>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Main Character</label>
        <input v-model="mainCharacter" class="w-full rounded-md bg-slate-900 border border-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-600" />
        <p class="text-xs text-slate-500 mt-1">Who is the protagonist? A name and a word or two describing them is fine.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">Genre</label>
          <input v-model="genre" class="w-full rounded-md bg-slate-900 border border-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-600" />
        </div>
      </div>

      <div class="pt-2 flex items-center gap-3">
        <button @click="start" :disabled="!canContinue" class="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-600">
          Start story
        </button>
        <button @click="save" class="inline-flex items-center rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700">
          Save
        </button>
        <span v-if="!canContinue" class="text-xs text-slate-500">World, two Books, Main Character, and Genre are required.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
