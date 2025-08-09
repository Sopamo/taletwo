import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './assets/main.css'
import VueMatomo from 'vue-matomo'

// One-time migration of localStorage keys from 'storyarc.' to 'taletwo.'
;(function migrateStoragePrefix() {
  try {
    if (typeof window === 'undefined') return
    const FLAG = 'taletwo.migratedFromStoryArc'
    const ls = window.localStorage
    if (ls.getItem(FLAG)) return
    const oldPrefix = 'storyarc.'
    const newPrefix = 'taletwo.'
    const keys: string[] = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (k) keys.push(k)
    }
    for (const k of keys) {
      if (k.startsWith(oldPrefix)) {
        const newKey = newPrefix + k.slice(oldPrefix.length)
        if (ls.getItem(newKey) === null) {
          const val = ls.getItem(k)
          if (val !== null) ls.setItem(newKey, val)
        }
        // Remove old key after copying to avoid duplication
        ls.removeItem(k)
      }
    }
    ls.setItem(FLAG, '1')
  } catch {}
})()

const app = createApp(App)

app.use(createPinia())
app.use(VueMatomo, {
  host: 'https://analytics.sopamo.de/',
  siteId: 6,
  router,
  enableLinkTracking: true,
})
app.use(router)

app.mount('#app')
