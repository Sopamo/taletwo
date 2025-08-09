<script setup lang="ts">
import { onMounted, onUpdated, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  title?: string
}>()

const scroller = ref<HTMLDivElement | null>(null)

function scrollToBottom() {
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

onMounted(scrollToBottom)
onUpdated(scrollToBottom)
watch(() => props.text, scrollToBottom)
</script>

<template>
  <section class="relative flex-1 flex flex-col min-h-0">
    <header v-if="title" class="mb-3 flex items-center gap-2">
      <h2 class="text-lg md:text-xl font-semibold text-slate-100">{{ title }}</h2>
    </header>

    <div
      ref="scroller"
      class="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/40 shadow-inner ring-1 ring-slate-700/30"
    >
      <div class="p-4 md:p-6">
        <p class="whitespace-pre-wrap leading-relaxed text-slate-200">
          {{ text }}
        </p>
      </div>
    </div>
  </section>
</template>
