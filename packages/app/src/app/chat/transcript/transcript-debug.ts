type TranscriptDebugPayload = {
  phase: 'event' | 'turn' | 'split' | 'render' | 'animation'
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
  void payload
}
