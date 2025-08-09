import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export type StoryConfig = {
  world: string
  inspirations: string[]
  likedCharacters: string[]
  genre: string
  tone: string
}

export const useStoryConfigStore = defineStore('storyConfig', () => {
  const world = useStorage<string>('storyarc.world', '')
  const inspirations = useStorage<string[]>('storyarc.inspirations', [])
  const likedCharacters = useStorage<string[]>('storyarc.likedCharacters', [])
  const genre = useStorage<string>('storyarc.genre', '')
  const tone = useStorage<string>('storyarc.tone', '')

  const isComplete = computed(() => {
    return world.value.trim().length > 0 && genre.value.trim().length > 0 && tone.value.trim().length > 0
  })

  function setAll(cfg: Partial<StoryConfig>) {
    if (cfg.world !== undefined) world.value = cfg.world
    if (cfg.inspirations !== undefined) inspirations.value = cfg.inspirations
    if (cfg.likedCharacters !== undefined) likedCharacters.value = cfg.likedCharacters
    if (cfg.genre !== undefined) genre.value = cfg.genre
    if (cfg.tone !== undefined) tone.value = cfg.tone
  }

  function reset() {
    world.value = ''
    inspirations.value = []
    likedCharacters.value = []
    genre.value = ''
    tone.value = ''
  }

  return {
    world,
    inspirations,
    likedCharacters,
    genre,
    tone,
    isComplete,
    setAll,
    reset,
  }
})
