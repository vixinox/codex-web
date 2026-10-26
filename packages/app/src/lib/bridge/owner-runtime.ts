import type { StreamHandle, StreamHandlers, StreamRequest } from '@/lib/owner-ws/owner-runtime'

export type OwnerRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  mutation?: boolean
}

export type OwnerBridge = {
  request(method: string, params?: unknown, options?: OwnerRequestOptions): Promise<unknown>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
}

let activeBridge: OwnerBridge | null = null

export function setOwnerBridge(bridge: OwnerBridge | null) {
  activeBridge = bridge
}

export function getOwnerBridge(): OwnerBridge {
  if (!activeBridge) throw new Error('Owner runtime is not connected.')
  return activeBridge
}
