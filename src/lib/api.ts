// API URL utilities for frontend
// If VITE_API_BASE_URL is set (e.g., https://api.example.com),
// requests will be sent to that origin. Otherwise, relative /api paths are used
// and handled by the Vite dev proxy or same-origin deployment.

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL || ''
  // Trim whitespace and trailing slashes
  const base = raw.trim().replace(/\/+$/, '')
  return base
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`apiUrl() expects an absolute path starting with '/': got ${path}`)
  }
  const base = getApiBaseUrl()
  return base ? `${base}${path}` : path
}
