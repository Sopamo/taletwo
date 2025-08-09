import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export type StoryConfig = {
  books: string[]
  world: string
  mainCharacter: string
  genre: string
}

export const useStoryConfigStore = defineStore('storyConfig', () => {
  const books = useStorage<string[]>('taletwo.books', [])
  const world = useStorage<string>('taletwo.world', '')
  const mainCharacter = useStorage<string>('taletwo.mainCharacter', '')
  const genre = useStorage<string>('taletwo.genre', '')

  const isComplete = computed(() => {
    return (
      books.value.filter((b) => b.trim().length > 0).length >= 2 &&
      world.value.trim().length > 0 &&
      mainCharacter.value.trim().length > 0 &&
      genre.value.trim().length > 0
    )
  })

  function setAll(cfg: Partial<StoryConfig>) {
    if (cfg.books !== undefined) books.value = cfg.books
    if (cfg.world !== undefined) world.value = cfg.world
    if (cfg.mainCharacter !== undefined) mainCharacter.value = cfg.mainCharacter
    if (cfg.genre !== undefined) genre.value = cfg.genre
  }

  function reset() {
    books.value = []
    world.value = ''
    mainCharacter.value = ''
    genre.value = ''
  }

  return {
    books,
    world,
    mainCharacter,
    genre,
    isComplete,
    setAll,
    reset,
  }
})
