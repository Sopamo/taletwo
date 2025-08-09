import { createRouter, createWebHistory } from 'vue-router'
import { hasApiKey } from '@/lib/apiKey'
import { useStoryConfigStore } from '@/stores/storyConfig'
import { useStoryPlanStore } from '@/stores/storyPlan'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'configure-guided',
      component: () => import('@/views/GuidedConfigureView.vue'),
    },
    {
      path: '/play',
      name: 'play',
      component: () => import('@/views/PlayView.vue'),
    },
    {
      path: '/plan-loading',
      name: 'plan-loading',
      component: () => import('@/views/PlanLoadingView.vue'),
    },
    {
      path: '/taletwo',
      name: 'taletwo',
      component: () => import('@/views/TaletwoView.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const cfg = useStoryConfigStore()
  const plan = useStoryPlanStore()
  // Require API key for all routes except the Taletwo key entry page
  if (to.name !== 'taletwo' && !hasApiKey()) {
    return { name: 'taletwo', query: { redirect: to.fullPath } }
  }
  if (to.name === 'play') {
    if (!cfg.isComplete) return { name: 'configure-guided' }
    // Ensure plan is ready before entering play
    if (!plan.isReady()) return { name: 'plan-loading' }
  }
})

export default router
