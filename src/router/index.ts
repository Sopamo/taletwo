import { createRouter, createWebHistory } from 'vue-router'
import { useStoryConfigStore } from '@/stores/storyConfig'
import { useStoryStore } from '@/stores/story'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/configure',
      name: 'configure-guided',
      component: () => import('@/views/GuidedConfigureView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/loading',
      name: 'plan-loading',
      component: () => import('@/views/PlanLoadingView.vue'),
    },
    {
      path: '/play/:bookId/:index',
      name: 'play',
      component: () => import('@/views/PlayView.vue'),
      meta: { requiresAuth: true },
    },
    // legacy routes removed: plan-loading, taletwo
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  const cfg = useStoryConfigStore()
  const story = useStoryStore()

  // Auth gate
  if (to.meta?.requiresAuth && !auth.user) {
    return { name: 'home' }
  }

  // Only require full config for play if story hasn't started yet
  if (to.name === 'play') {
    if (!story.hasStarted && !cfg.isComplete) return { name: 'configure-guided' }
  }
})

export default router
