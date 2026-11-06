import { encodeOwnerFrame, parseOwnerFrame } from '@codex-web/protocol/owner'
import type { PublicErrorDto } from '@codex-web/telemetry/errors'
import { OwnerRequestError } from './owner-runtime'

export type OwnerManagementRpc = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

export function connectOwnerManagementRpc(sessionToken?: string): Promise<OwnerManagementRpc> {
  const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws`)
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let nextId = 0
  let settled = false
  let closed = false
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      if (closed) return
      closed = true
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      if (!settled) reject(error)
    }
    socket.onerror = () => fail(new Error('Owner connection failed'))
    socket.onclose = () => {
      if (closed) return
      closed = true
      const error = new Error('Owner connection closed')
      for (const request of pending.values()) request.reject(error)
      pending.clear()
    }
    socket.onmessage = (event) => {
      const parsed = parseOwnerFrame(typeof event.data === 'string' ? event.data : '')
      if (!parsed.ok) {
        fail(new Error('Owner sent an invalid protocol frame.'))
        socket.close(1002, 'invalid owner frame')
        return
      }
      if (parsed.frame.type === 'ready') {
        if (settled) return
        settled = true
        resolve({
          request(method: string, params?: Record<string, unknown>) {
            const requestId = `owner-management-${++nextId}`
            return new Promise((requestResolve, requestReject) => {
              if (closed) {
                requestReject(new Error('Owner connection closed'))
                return
              }
              pending.set(requestId, { resolve: requestResolve, reject: requestReject })
              socket.send(encodeOwnerFrame({ type: 'request', requestId, method, params }))
            })
          },
          close() {
            if (closed) return
            closed = true
            const error = new Error('Owner connection closed')
            for (const request of pending.values()) request.reject(error)
            pending.clear()
            socket.close(1000, 'closed')
          },
        })
      }
      if (parsed.frame.type !== 'response') return
      const request = pending.get(parsed.frame.requestId)
      if (!request) return
      pending.delete(parsed.frame.requestId)
      if (parsed.frame.error) request.reject(ownerError(parsed.frame.error))
      else request.resolve(parsed.frame.result)
    }
    socket.onopen = () => {
      socket.send(
        encodeOwnerFrame({
          type: 'hello',

          clientId: 'owner-management',
          capabilities: ['owner', 'remote-administration'],
          ...(sessionToken ? { sessionToken } : {}),
        }),
      )
    }
  })
}

function ownerError(error: PublicErrorDto) {
  return new OwnerRequestError(error)
}
