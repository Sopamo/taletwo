import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './assets/main.css'
import VueMatomo from 'vue-matomo'

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
