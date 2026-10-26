import type { StreamHandle, StreamHandlers, StreamRequest } from '@/lib/owner-ws/owner-runtime'

export type OwnerRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  mutation?: boolean
}

export type OwnerBridge = {
  request<T = unknown>(method: string, params?: unknown, options?: OwnerRequestOptions): Promise<T>
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
    const path = method.startsWith('codex.')
      ? `/api/codex/${method.slice(6)}`
      : method === 'credentials.select'
        ? '/api/credentials/current'
        : method.startsWith('credentials.')
          ? '/api/credentials'
          : null
    if (!path) throw new Error(`No test bridge mapping for ${method}`)
    const init: RequestInit = { signal: options?.signal }
    if (method !== 'codex.status' && method !== 'credentials.list') {
      init.method = method === 'credentials.select' ? 'PUT' : 'POST'
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(params ?? {})
    }
    const response = await fetch(path, init)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string } | string
      } | null
      throw new Error(
        typeof body?.error === 'string' ? body.error : (body?.error?.message ?? 'Request failed'),
      )
    }
    return response.status === 204 ? null : response.json()
  },
  openStream() {
    return { streamId: null, cancel: () => undefined }
  },
}
