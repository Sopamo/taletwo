import { defineStore } from 'pinia'
import { ref } from 'vue'
import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  setPersistence,
  browserLocalPersistence,
  type User,
} from 'firebase/auth'

function initFirebaseClient() {
  if (typeof window === 'undefined') return
  if (getApps().length) return
  const cfg = {
    apiKey: 'AIzaSyCSpz4L-Muj4taLuv0HdgqWwu7VguguQKw',
    authDomain: 'taletwo-8fa50.firebaseapp.com',
    projectId: 'taletwo-8fa50',
    storageBucket: 'taletwo-8fa50.firebasestorage.app',
    messagingSenderId: '644181378761',
    appId: '1:644181378761:web:aefac61cfed37a4f026f18',
  }
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId || !cfg.appId) {
    console.warn('[auth] Missing Firebase web config (VITE_FIREBASE_*)')
  }
  initializeApp(cfg)
}

export const useAuthStore = defineStore('auth', () => {
  initFirebaseClient()
  const auth = getAuth()
  setPersistence(auth, browserLocalPersistence).catch(() => {})

  const user = ref<User | null>(auth.currentUser)
  const idToken = ref<string | null>(null)
  const loading = ref<boolean>(true)
  const error = ref<string | null>(null)

  onAuthStateChanged(auth, async (u: User | null) => {
    user.value = u
    if (u) {
      try {
        idToken.value = await u.getIdToken()
      } catch {
        idToken.value = null
      }
    } else {
      idToken.value = null
    }
    loading.value = false
  })

  async function getIdToken(forceRefresh = false): Promise<string | null> {
    try {
      const u = auth.currentUser
      if (!u) return null
      idToken.value = await u.getIdToken(forceRefresh)
      return idToken.value
    } catch (e: any) {
      error.value = e?.message || 'Failed to get ID token'
      return null
    }
  }

  async function signInWithGoogle() {
    error.value = null
    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
      await getIdToken(true)
    } catch (e: any) {
      error.value = e?.message || 'Login failed'
    }
  }

  async function signOut() {
    error.value = null
    try {
      await fbSignOut(auth)
      idToken.value = null
    } catch (e: any) {
      error.value = e?.message || 'Logout failed'
    }
  }

  async function authHeaders(extra?: HeadersInit): Promise<HeadersInit> {
    const t = await getIdToken()
    const base: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {}
    return { ...base, ...(extra || {}) }
  }

  return {
    user,
    idToken,
    loading,
    error,
    getIdToken,
    signInWithGoogle,
    signOut,
    authHeaders,
  }
})
