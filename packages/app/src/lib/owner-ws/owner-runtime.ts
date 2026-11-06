import {
  encodeOwnerFrame,
  isOwnerEventErrorCode,
  parseOwnerFrame,
  type OwnerCapability,
  type OwnerFrame,
} from '@codex-web/protocol/owner'
import type { PublicErrorDto } from '@codex-web/telemetry/errors'
import { AppLocalError, AppLocalErrorCode } from '@/lib/errors/app-local-error'

export type OwnerTarget = {
  url: string
  clientId?: string
  capabilities?: readonly string[]
  sessionToken?: string
}

export type RequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  idempotent?: boolean
}

export type StreamRequest = {
  method: string
  params?: unknown
  options?: RequestOptions
}

export type StreamHandlers = {
  onOpen?: (meta: unknown) => void
  onEvent: (event: unknown) => void
  onClose?: (reason?: string) => void
  onError?: (error: Error) => void
}

export type StreamHandle = {
  readonly streamId: string | null
  cancel(): void
}

export type OwnerTransportState = 'disconnected' | 'connecting' | 'connected' | 'failed'
export type OwnerAuthenticationState =
  | 'unknown'
  | 'unauthenticated'
  | 'authenticated'
  | 'expired'
  | 'revoked'
  | 'failed'
export type OwnerRuntimePhase = 'idle' | 'resuming' | 'ready' | 'blocked' | 'failed'

export class OwnerRequestError extends Error {
  readonly publicError: PublicErrorDto
  readonly code: PublicErrorDto['code']
  readonly params: PublicErrorDto['params']
  readonly retryable: PublicErrorDto['retryable']

  constructor(error: PublicErrorDto, options?: ErrorOptions) {
    super(error.message ?? 'Owner request failed.', options)
    this.name = 'OwnerRequestError'
    this.publicError = error
    this.code = error.code
    this.params = error.params
    this.retryable = error.retryable
  }
}

export class OwnerConnectionError extends AppLocalError {
  constructor(
    message: string,
    code: AppLocalErrorCode = AppLocalErrorCode.ownerConnectionUnavailable,
  ) {
    super(code, message)
    this.name = 'OwnerConnectionError'
  }
}

export class OwnerLocalRequestError extends AppLocalError {
  constructor(code: AppLocalErrorCode, message: string) {
    super(code, message)
    this.name = 'OwnerLocalRequestError'
  }
}

export type OwnerRuntime = {
  readonly state: OwnerTransportState
  readonly authenticated: boolean
  readonly authentication: OwnerAuthenticationState
  readonly phase: OwnerRuntimePhase
  readonly connectionId: string | null
  connect(target: OwnerTarget): Promise<void>
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
  cancelRequest(requestId: string): void
  cancelStream(streamId: string): void
  subscribeNotification(listener: (method: string, params: unknown) => void): () => void
  close(reason?: string): void
  subscribe(listener: () => void): () => void
}

type WebSocketLike = Pick<WebSocket, 'send' | 'close'> & {
  readyState: number
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
}

type WebSocketFactory = (url: string) => WebSocketLike

const OPEN = 1
const DEFAULT_TIMEOUT_MS = 30_000

export function createOwnerRuntime(
  webSocketFactory: WebSocketFactory = (url) => new WebSocket(url),
): OwnerRuntime {
  let state: OwnerTransportState = 'disconnected'
  let socket: WebSocketLike | null = null
  let connectionId: string | null = null
  let authenticated = false
  let authentication: OwnerAuthenticationState = 'unknown'
  let phase: OwnerRuntimePhase = 'idle'
  let closed = false
  let nextId = 0
  const pending = new Map<string, PendingRequest>()
  const streams = new Map<string, ActiveStream>()
  const listeners = new Set<() => void>()
  const notificationListeners = new Set<(method: string, params: unknown) => void>()

  const publish = () => listeners.forEach((listener) => listener())
  const setState = (next: OwnerTransportState) => {
    if (state === next) return
    state = next
    publish()
  }

  const failAll = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.abortCleanup?.()
      request.reject(error)
    }
    pending.clear()
    for (const stream of streams.values()) {
      clearTimeout(stream.timer)
      stream.abortCleanup?.()
      stream.handlers.onError?.(error)
      stream.handlers.onClose?.('CONNECTION_CLOSED')
    }
    streams.clear()
  }

  const shutdown = (reason: string, error: Error = new OwnerConnectionError(reason)) => {
    if (closed && !socket) return
    closed = true
    const current = socket
    socket = null
    connectionId = null
    authenticated = false
    authentication = 'unknown'
    phase = 'idle'
    failAll(error)
    current?.close(1000, reason)
    setState('disconnected')
  }

  const handleFrame = (frame: OwnerFrame) => {
    if (frame.type === 'ready') {
      connectionId = frame.connectionId
      authenticated = frame.authenticated
      authentication = frame.authenticated ? 'authenticated' : 'unauthenticated'
      phase = frame.authenticated ? 'ready' : 'idle'
      closed = false
      setState('connected')
      return
    }
    if (frame.type === 'response') {
      const streamRequest = streams.get(frame.requestId)
      if (streamRequest) {
        if (frame.error) {
          streams.delete(frame.requestId)
          clearTimeout(streamRequest.timer)
          streamRequest.abortCleanup?.()
          streamRequest.handlers.onError?.(new OwnerRequestError(frame.error))
          streamRequest.handlers.onClose?.(frame.error.code)
        }
        return
      }
      const request = pending.get(frame.requestId)
      if (!request) return
      pending.delete(frame.requestId)
      clearTimeout(request.timer)
      request.abortCleanup?.()
      if (frame.error) request.reject(new OwnerRequestError(frame.error))
      else request.resolve(frame.result)
      return
    }
    if (frame.type === 'notification') {
      notificationListeners.forEach((listener) => listener(frame.method, frame.params))
      return
    }
    if (frame.type === 'stream.open') {
      const stream = streams.get(frame.requestId)
      if (stream) {
        streams.delete(frame.requestId)
        streams.set(frame.streamId, stream)
        stream.open = true
        stream.handlers.onOpen?.(frame.meta)
      }
      return
    }
    if (frame.type === 'stream.event') {
      streams.get(frame.streamId)?.handlers.onEvent(frame.event)
      return
    }
    if (frame.type === 'stream.close') {
      const stream = streams.get(frame.streamId)
      if (!stream) return
      streams.delete(frame.streamId)
      clearTimeout(stream.timer)
      stream.abortCleanup?.()
      if (isOwnerEventErrorCode(frame.reason))
        stream.handlers.onError?.(
          new OwnerConnectionError(
            'Owner event stream failed contract validation.',
            AppLocalErrorCode.ownerProtocolInvalidFrame,
          ),
        )
      stream.handlers.onClose?.(frame.reason)
      return
    }
    if (frame.type === 'close') {
      const error = new OwnerConnectionError('Owner connection was closed by the server.')
      if (state === 'connecting') rejectConnection?.(error)
      shutdown(frame.code, error)
    }
  }

  let rejectConnection: ((error: Error) => void) | undefined

  const attach = (next: OwnerTarget, resolve: () => void, reject: (error: Error) => void) => {
    const nextSocket = webSocketFactory(next.url)
    socket = nextSocket
    nextSocket.onopen = () => {
      try {
        nextSocket.send(
          encodeOwnerFrame({
            type: 'hello',

            clientId: next.clientId ?? 'owner-runtime',
            capabilities: [...(next.capabilities ?? (['owner'] satisfies OwnerCapability[]))],
            ...(next.sessionToken ? { sessionToken: next.sessionToken } : {}),
          }),
        )
      } catch (error) {
        const cause = error instanceof Error ? error : new OwnerConnectionError('Hello failed')
        shutdown('HELLO_FAILED', cause)
        reject(cause)
      }
    }
    nextSocket.onmessage = (event) => {
      const parsed = parseOwnerFrame(typeof event.data === 'string' ? event.data : '')
      if (!parsed.ok) {
        const error = new OwnerConnectionError(
          'Owner sent an invalid protocol frame.',
          AppLocalErrorCode.ownerProtocolInvalidFrame,
        )
        if (state === 'connecting') reject(error)
        shutdown(parsed.error.code, error)
        phase = 'failed'
        authentication = 'failed'
        setState('failed')
        return
      }
      const wasConnecting = state === 'connecting'
      handleFrame(parsed.frame)
      if (wasConnecting && parsed.frame.type === 'ready') {
        rejectConnection = undefined
        resolve()
      }
    }
    nextSocket.onerror = () => {
      const error = new OwnerConnectionError('Owner connection failed')
      if (state === 'connecting') reject(error)
      shutdown('CONNECTION_FAILED', error)
      phase = 'failed'
      authentication = 'failed'
      setState('failed')
    }
    nextSocket.onclose = () => {
      const error = new OwnerConnectionError('Owner connection closed')
      if (state === 'connecting') reject(error)
      shutdown('CONNECTION_CLOSED', error)
    }
    if (nextSocket.readyState === OPEN) nextSocket.onopen(new Event('open'))
  }

  const connect = (next: OwnerTarget) => {
    shutdown('REPLACED')
    closed = false
    phase = next.sessionToken ? 'resuming' : 'idle'
    authentication = next.sessionToken ? 'unknown' : 'unauthenticated'
    setState('connecting')
    return new Promise<void>((resolve, reject) => {
      rejectConnection = reject
      attach(next, resolve, reject)
    })
  }

  const request = <T>(method: string, params?: unknown, options: RequestOptions = {}) => {
    const requestId = `owner-${++nextId}`
    return new Promise<unknown>((resolve, reject) => {
      if (!socket || socket.readyState !== OPEN || state !== 'connected') {
        reject(new OwnerConnectionError('Owner connection is not ready'))
        return
      }
      const timer = setTimeout(() => {
        pending.delete(requestId)
        options.signal?.removeEventListener('abort', onAbort)
        try {
          socket?.send(encodeOwnerFrame({ type: 'cancel', requestId }))
        } catch {
          /* closed */
        }
        reject(
          new OwnerLocalRequestError(
            AppLocalErrorCode.ownerRequestTimeout,
            'The request timed out.',
          ),
        )
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const onAbort = () => {
        if (!pending.delete(requestId)) return
        clearTimeout(timer)
        try {
          socket?.send(encodeOwnerFrame({ type: 'cancel', requestId }))
        } catch {
          /* closed */
        }
        reject(
          new OwnerLocalRequestError(
            AppLocalErrorCode.ownerRequestCancelled,
            'The request was cancelled.',
          ),
        )
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(requestId, {
        resolve,
        reject,
        timer,
        abortCleanup: () => options.signal?.removeEventListener('abort', onAbort),
      })
      try {
        socket.send(
          encodeOwnerFrame({
            type: 'request',
            requestId,
            method,
            ...(params === undefined ? {} : { params }),
          }),
        )
      } catch (error) {
        pending.delete(requestId)
        clearTimeout(timer)
        onAbort()
        reject(error instanceof Error ? error : new OwnerConnectionError('Request failed'))
      }
    }) as Promise<T>
  }

  const openStream = (request: StreamRequest, handlers: StreamHandlers): StreamHandle => {
    const requestId = `owner-${++nextId}`
    let streamId: string | null = null
    const timer = setTimeout(() => {
      if (streamId) cancelStream(streamId)
      else {
        streams.delete(requestId)
        try {
          socket?.send(encodeOwnerFrame({ type: 'cancel', requestId }))
        } catch {
          /* closed */
        }
        placeholder.abortCleanup?.()
        handlers.onClose?.('REQUEST_TIMEOUT')
      }
      handlers.onError?.(
        new OwnerLocalRequestError(AppLocalErrorCode.ownerRequestTimeout, 'The stream timed out.'),
      )
    }, request.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const placeholder: ActiveStream = {
      requestId,
      timer,
      handlers,
      open: false,
      abortCleanup: undefined,
    }
    const handle = {
      get streamId() {
        return streamId
      },
      cancel: () => (streamId ? cancelStream(streamId) : cancelRequest(requestId)),
    }
    if (!socket || socket.readyState !== OPEN || state !== 'connected') {
      clearTimeout(timer)
      handlers.onError?.(new OwnerConnectionError('Owner connection is not ready'))
      handlers.onClose?.('CONNECTION_NOT_READY')
      return handle
    }
    const onAbort = () => (streamId ? cancelStream(streamId) : cancelRequest(requestId))
    request.options?.signal?.addEventListener('abort', onAbort, { once: true })
    placeholder.abortCleanup = () => request.options?.signal?.removeEventListener('abort', onAbort)
    streams.set(requestId, placeholder)
    try {
      socket.send(
        encodeOwnerFrame({
          type: 'request',
          requestId,
          method: request.method,
          ...(request.params === undefined ? {} : { params: request.params }),
        }),
      )
    } catch {
      streams.delete(requestId)
      clearTimeout(timer)
      placeholder.abortCleanup?.()
      handlers.onError?.(new OwnerConnectionError('Stream request failed'))
      handlers.onClose?.('SEND_FAILED')
    }
    const originalHandle = handle
    const poll = setInterval(() => {
      for (const [id, stream] of streams)
        if (stream.requestId === requestId && id !== requestId) {
          streamId = id
          clearInterval(poll)
          return
        }
      if (!streams.has(requestId)) clearInterval(poll)
    }, 0)
    return originalHandle
  }

  const cancelRequest = (requestId: string) => {
    const stream = streams.get(requestId)
    if (stream) {
      streams.delete(requestId)
      clearTimeout(stream.timer)
      stream.abortCleanup?.()
      try {
        socket?.send(encodeOwnerFrame({ type: 'cancel', requestId }))
      } catch {
        /* closed */
      }
      stream.handlers.onClose?.('REQUEST_CANCELLED')
      return
    }
    if (!pending.has(requestId)) return
    try {
      socket?.send(encodeOwnerFrame({ type: 'cancel', requestId }))
    } catch {
      /* closed */
    }
  }
  const cancelStream = (streamId: string) => {
    const stream = streams.get(streamId)
    if (!stream) return
    streams.delete(streamId)
    clearTimeout(stream.timer)
    stream.abortCleanup?.()
    try {
      socket?.send(encodeOwnerFrame({ type: 'cancel', streamId }))
    } catch {
      /* closed */
    }
    stream.handlers.onClose?.('REQUEST_CANCELLED')
  }

  return {
    get state() {
      return state
    },
    get authenticated() {
      return authenticated
    },
    get authentication() {
      return authentication
    },
    get phase() {
      return phase
    },
    get connectionId() {
      return connectionId
    },
    connect,
    request,
    openStream,
    cancelRequest,
    cancelStream,
    subscribeNotification: (listener) => {
      notificationListeners.add(listener)
      return () => notificationListeners.delete(listener)
    },
    close: (reason = 'CLOSED') => shutdown(reason),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  abortCleanup?: () => void
}

type ActiveStream = {
  requestId: string
  timer: ReturnType<typeof setTimeout>
  handlers: StreamHandlers
  open: boolean
  abortCleanup?: () => void
}
