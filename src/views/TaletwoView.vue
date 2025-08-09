<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { setApiKey, getApiKey } from '@/lib/apiKey'
import { checkApiKeyValid } from '@/lib/llm'

const router = useRouter()
const route = useRoute()

const key = ref('')
const saved = ref(false)
const testing = ref(false)
const error = ref<string | null>(null)

watchEffect(() => {
  // If already set, skip away
  const existing = getApiKey()
  if (existing) {
    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
  }
})

async function save() {
  const trimmed = key.value.trim()
  if (!trimmed || testing.value) return
  testing.value = true
  error.value = null
  try {
    await checkApiKeyValid(trimmed)
  } catch (e: any) {
    error.value = e?.message || 'API key validation failed. Please check the key and try again.'
    testing.value = false
    return
  }
  setApiKey(trimmed)
  saved.value = true
  const redirect = (route.query.redirect as string) || '/'
  router.replace(redirect)
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
    <div class="w-full max-w-md p-6 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur">
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-semibold tracking-tight">taletwo</h1>
        <p class="mt-1 text-sm text-slate-400">Enter your OpenAI API key to continue.</p>
      </div>

      <label class="block text-sm font-medium text-slate-300">OpenAI API Key</label>
      <input
        v-model="key"
        type="password"
        placeholder="sk-..."
        class="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <p class="mt-2 text-xs text-slate-400">Your key is stored locally in your browser (localStorage) and never sent anywhere except directly to OpenAI.</p>

      <button
        :disabled="!key.trim() || testing"
        @click="save"
        class="mt-4 w-full rounded-md border px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500"
      >{{ testing ? 'Validating…' : 'Save and Continue' }}</button>

      <p v-if="saved" class="mt-3 text-xs text-emerald-400">Saved. Redirecting…</p>
      <p v-else-if="error" class="mt-3 text-xs text-rose-400">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
</style>
