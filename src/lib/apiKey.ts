export const LS_API_KEY = 'taletwo:openai_api_key'

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(LS_API_KEY)
  } catch {
    return null
  }
}

export function setApiKey(key: string): void {
  try {
    localStorage.setItem(LS_API_KEY, key)
  } catch {
    // ignore
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(LS_API_KEY)
  } catch {
    // ignore
  }
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}
