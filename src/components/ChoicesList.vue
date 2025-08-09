<script setup lang="ts">
import ChoiceButton from './ChoiceButton.vue'

type Choice = string | { id?: string | number; label: string }

const props = defineProps<{
  title?: string
  choices: Choice[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', payload: string): void
}>()

function labelOf(c: Choice): string {
  return typeof c === 'string' ? c : c.label
}

function keyOf(c: Choice, idx: number): string | number {
  if (typeof c === 'string') return `${idx}-${c}`
  return c.id ?? `${idx}-${c.label}`
}
</script>

<template>
  <section class="space-y-3">
    <header v-if="title" class="flex items-center gap-2">
      <h3 class="text-base md:text-lg font-medium text-slate-200">{{ title }}</h3>
    </header>

    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
      <ChoiceButton
        v-for="(c, idx) in props.choices"
        :key="keyOf(c, idx)"
        :label="labelOf(c)"
        :disabled="props.disabled"
        @click="emit('select', labelOf(c))"
      />
    </div>
  </section>
</template>
