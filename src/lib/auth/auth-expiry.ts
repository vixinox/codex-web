export const AUTH_EXPIRED_EVENT = 'codex-web:auth-expired'

const PROTECTED_PATH_PREFIXES = ['/api/', '/guest-api/', '/admin-api/'] as const

let activeRestore: (() => void) | null = null

function isProtectedRequest(input: RequestInfo | URL) {
  const rawUrl = input instanceof Request ? input.url : String(input)
  let url: URL
  try {
    url = new URL(rawUrl, window.location.href)
  } catch {
    return false
  }

  if (url.origin !== window.location.origin) return false
  if (!PROTECTED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return false
  return !url.pathname.startsWith('/api/auth/')
}

export function installAuthExpiryInterceptor() {
  if (activeRestore) return activeRestore

  const originalFetch = window.fetch
  const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch.call(window, input, init)
    if (response.status === 401 && isProtectedRequest(input))
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    return response
  }) as typeof window.fetch

  window.fetch = wrappedFetch
  const restore = () => {
    if (window.fetch === wrappedFetch) window.fetch = originalFetch
    if (activeRestore === restore) activeRestore = null
  }
  activeRestore = restore
  return restore
}
