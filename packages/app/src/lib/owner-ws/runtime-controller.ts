import {
  createOwnerRuntime,
  OwnerConnectionError,
  type OwnerRuntime,
  type OwnerRuntimePhase,
  type OwnerTarget,
  type OwnerAuthenticationState,
  type RequestOptions,
  type StreamHandle,
  type StreamHandlers,
  type StreamRequest,
  type OwnerTransportState,
} from './owner-runtime'

export type OwnerRuntimeState = {
  transport: OwnerTransportState | 'reconnecting'
  authentication: OwnerAuthenticationState | 'pending_binding' | 'pending_totp'
  runtime: OwnerRuntimePhase
  error: string | null
  reconnectAttempt: number
}

export type OwnerRuntimeController = {
  readonly state: OwnerRuntimeState
  readonly runtime: OwnerRuntime
  connect(target: OwnerTarget): Promise<void>
  retry(): Promise<void>
  switchTarget(target: OwnerTarget): Promise<void>
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
  close(reason?: string): void
  subscribe(listener: () => void): () => void
}

export type OwnerRuntimeControllerOptions = {
  maxReconnectAttempts?: number
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
}

const defaultOptions: Required<OwnerRuntimeControllerOptions> = {
  maxReconnectAttempts: 5,
  reconnectDelayMs: 500,
  maxReconnectDelayMs: 30_000,
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
}

export function createOwnerRuntimeController(
  runtime: OwnerRuntime = createOwnerRuntime(),
  providedOptions: OwnerRuntimeControllerOptions = {},
): OwnerRuntimeController {
  const options = { ...defaultOptions, ...providedOptions }
  const listeners = new Set<() => void>()
  let target: OwnerTarget | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let explicitlyClosed = false
  let reconnectAttempt = 0
  let state: OwnerRuntimeState = {
    transport: 'disconnected',
    authentication: 'unknown',
    runtime: 'idle',
    error: null,
    reconnectAttempt: 0,
  }

  const publish = () => listeners.forEach((listener) => listener())
  const update = (next: Partial<OwnerRuntimeState>) => {
    state = { ...state, ...next }
    publish()
  }

  const clearReconnect = () => {
    if (reconnectTimer !== null) options.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const scheduleReconnect = () => {
    if (explicitlyClosed || !target || reconnectTimer !== null) return
    if (reconnectAttempt >= options.maxReconnectAttempts) {
      update({
        transport: 'failed',
        runtime: 'failed',
        error: 'Owner connection could not be restored.',
      })
      return
    }
    const delay = Math.min(
      options.maxReconnectDelayMs,
      options.reconnectDelayMs * 2 ** reconnectAttempt,
    )
    reconnectAttempt += 1
    update({ transport: 'reconnecting', runtime: 'resuming', reconnectAttempt, error: null })
    reconnectTimer = options.setTimeout(() => {
      reconnectTimer = null
      if (!target || explicitlyClosed) return
      void connectTarget(target, true).catch(() => undefined)
    }, delay)
  }

  const transportUnsubscribe = runtime.subscribe(() => {
    if (runtime.state === 'connected') {
      reconnectAttempt = 0
      update({
        transport: 'connected',
        authentication: runtime.authentication,
        runtime: runtime.phase,
        error: null,
        reconnectAttempt: 0,
      })
      return
    }
    if (runtime.state === 'failed') {
      update({
        transport: 'failed',
        authentication: runtime.authentication,
        runtime: 'failed',
        error: 'Owner connection failed.',
      })
      scheduleReconnect()
      return
    }
    if (runtime.state === 'disconnected' && !explicitlyClosed) {
      update({
        transport: target ? 'reconnecting' : 'disconnected',
        authentication: runtime.authentication,
        runtime: target ? 'resuming' : 'idle',
      })
      scheduleReconnect()
    }
  })

  const connectTarget = async (next: OwnerTarget, isReconnect = false) => {
    clearReconnect()
    explicitlyClosed = false
    target = next
    update({
      transport: isReconnect ? 'reconnecting' : 'connecting',
      authentication: next.sessionToken ? 'unknown' : 'unauthenticated',
      runtime: next.sessionToken ? 'resuming' : 'idle',
      error: null,
    })
    try {
      await runtime.connect(next)
      update({
        transport: 'connected',
        authentication: runtime.authentication,
        runtime: runtime.phase,
        error: null,
        reconnectAttempt: 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Owner connection failed.'
      update({
        transport: 'failed',
        runtime: 'failed',
        error: message,
      })
      scheduleReconnect()
      throw error
    }
  }

  return {
    get state() {
      return state
    },
    runtime,
    connect: (next) => connectTarget(next),
    retry: async () => {
      if (!target) throw new OwnerConnectionError('Owner connection target is missing.')
      reconnectAttempt = 0
      await connectTarget(target)
    },
    switchTarget: async (next) => {
      clearReconnect()
      runtime.close('switch target')
      await connectTarget(next)
    },
    request: (method, params, requestOptions) => runtime.request(method, params, requestOptions),
    openStream: (request, handlers) => runtime.openStream(request, handlers),
    close: (reason = 'closed') => {
      explicitlyClosed = true
      target = null
      clearReconnect()
      transportUnsubscribe()
      runtime.close(reason)
      update({
        transport: 'disconnected',
        authentication: 'unknown',
        runtime: 'idle',
        error: null,
        reconnectAttempt: 0,
      })
      listeners.clear()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
