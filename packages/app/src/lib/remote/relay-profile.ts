const LOCAL_RELAY_URL = 'ws://127.0.0.1:8787/ws'

/**
 * The Relay endpoint is deployment configuration. It is deliberately not read from a
 * bootstrap URL or QR payload, where it would become an untrusted routing input.
 */
export function remoteRelayUrl(): string {
  const configured = import.meta.env.VITE_CODEX_REMOTE_RELAY_URL?.trim()
  const value = configured || (import.meta.env.DEV ? LOCAL_RELAY_URL : '')
  if (!value) throw new Error('Remote Relay URL is not configured.')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Remote Relay URL is invalid.')
  }
  if (
    !['ws:', 'wss:'].includes(parsed.protocol) ||
    !parsed.host ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Remote Relay URL must use ws:// or wss://.')
  return parsed.toString()
}

export function buildFirstSessionUrl(reference: string, appOrigin = window.location.origin) {
  if (!/^[A-Za-z0-9_-]{16,256}$/u.test(reference))
    throw new Error('Bootstrap reference is invalid.')
  const origin = new URL(appOrigin)
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('App origin is invalid.')
  const url = new URL('/app/first-session', origin)
  url.searchParams.set('ref', reference)
  return url.toString()
}
