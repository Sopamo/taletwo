import { createRouter, createWebHistory } from 'vue-router'
import { useStoryConfigStore } from '@/stores/storyConfig'
import { useStoryPlanStore } from '@/stores/storyPlan'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'configure',
      component: () => import('@/views/ConfigureView.vue'),
    },
    {
      path: '/configure/guided',
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
  ],
})

router.beforeEach((to) => {
  const cfg = useStoryConfigStore()
  const plan = useStoryPlanStore()
  if (to.name === 'play') {
    if (!cfg.isComplete) return { name: 'configure-guided' }
    // Ensure plan is ready before entering play
    if (!plan.isReady()) return { name: 'plan-loading' }
  }
  if (to.name === 'configure') {
    const firstTime =
      !cfg.world && !cfg.genre && !cfg.tone && (!cfg.inspirations?.length) && (!cfg.likedCharacters?.length)
    if (firstTime) return { name: 'configure-guided' }
  }
})

export default router
