const STORAGE_KEY = 'codex_web_product_events'

export type ProductEvent =
  | 'startup_connection_checked'
  | 'startup_connection_failed'
  | 'workspace_opened'
  | 'thread_opened'
  | 'turn_accepted'
  | 'sse_reconnected'

export function trackProductEvent(event: ProductEvent) {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}')
    const counts = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
    const current = typeof counts[event] === 'number' ? counts[event] : 0
    counts[event] = current + 1
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
  } catch {
    // Metrics are best effort and must never affect the product flow.
  }
}
