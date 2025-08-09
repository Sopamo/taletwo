<script setup lang="ts">
const props = defineProps<{
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'click'): void
}>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm md:text-base font-medium text-white shadow-sm ring-1 ring-inset ring-indigo-500/20 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    :disabled="props.disabled"
    @click="emit('click')"
  >
    {{ props.label }}
  </button>
</template>
