<script setup lang="ts">
import { computed } from 'vue'

const model = defineModel<string>({ default: '' })

const props = defineProps<{
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', value: string): void
}>()

const canSubmit = computed(() => !props.disabled && model.value.trim().length > 0)

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', model.value.trim())
  model.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    onSubmit()
  }
}
</script>

<template>
  <div class="w-full">
    <div class="flex items-end gap-2">
      <textarea
        v-model="model"
        :placeholder="props.placeholder ?? 'Type your action or say something...'"
        :disabled="props.disabled"
        rows="2"
        @keydown="onKeydown"
        class="min-h-[44px] w-full resize-y rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-slate-100 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
      />
      <button
        type="button"
        :disabled="!canSubmit"
        @click="onSubmit"
        class="inline-flex h-[44px] shrink-0 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-indigo-500/20 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Send
      </button>
    </div>
    <p class="mt-1 text-xs text-slate-400">Press Ctrl/⌘ + Enter to send</p>
  </div>
</template>
