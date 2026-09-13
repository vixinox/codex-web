type TranscriptDebugPayload = {
  phase: 'event' | 'turn' | 'split' | 'render' | 'gsap'
  threadId?: string
  turnId?: string
  itemId?: string
  eventId?: string | number
  method?: string
  status?: string
  blockCount?: number
  pendingLength?: number
  preview?: boolean
  visible?: boolean
  revision?: string
  elementCount?: number
  settled?: boolean
  [key: string]: unknown
}

export function transcriptDebug(payload: TranscriptDebugPayload) {
  if (!import.meta.env.DEV) return
  const safe = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
  console.debug('[transcript]', safe)
}
