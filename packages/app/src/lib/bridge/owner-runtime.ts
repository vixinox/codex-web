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
  if (!activeBridge && import.meta.env.MODE === 'test') return testBridge
  if (!activeBridge) throw new Error('Owner runtime is not connected.')
  return activeBridge
}

const testBridge: OwnerBridge = {
  async request(method, params, options) {
    const paths: Record<string, string> = {
      'codex.status': '/api/codex/status',
      'codex.start': '/api/codex/start',
      'codex.restart': '/api/codex/restart',
      'credentials.list': '/api/credentials',
      'credentials.create': '/api/credentials',
      'credentials.select': '/api/credentials/current',
      'credentials.delete': '/api/credentials',
    }
    const path = paths[method]
    if (!path) throw new Error(`No test bridge mapping for ${method}`)
    const init: RequestInit = { signal: options?.signal }
    if (method !== 'codex.status' && method !== 'credentials.list') {
      init.method =
        method === 'credentials.select' ? 'PUT' : method.endsWith('.delete') ? 'DELETE' : 'POST'
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(params ?? {})
    }
    const response = await window.fetch(path, init)
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return response.status === 204 ? null : response.json()
  },
  openStream() {
    return { streamId: null, cancel: () => undefined }
  },
}
