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
import { presentAppError } from '@/lib/errors/presentation'

export type OwnerRuntimeState = {
  transport: OwnerTransportState | 'reconnecting'
  authentication: OwnerAuthenticationState | 'pending_binding'
  runtime: OwnerRuntimePhase
  error: string | null
  reconnectAttempt: number
}

export type OwnerRuntimeController = {
  readonly state: OwnerRuntimeState
  connect(target: OwnerTarget): Promise<void>
  retry(): Promise<void>
  switchTarget(target: OwnerTarget): Promise<void>
  isAuthenticationRejection(): boolean
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
  subscribeNotification(listener: (method: string, params: unknown) => void): () => void
  waitForConnection(signal?: AbortSignal): Promise<void>
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
  let disposed = false
  const connectionWaiters = new Set<{
    resolve: () => void
    reject: (error: Error) => void
    cleanup: () => void
  }>()
  let state: OwnerRuntimeState = {
    transport: 'disconnected',
    authentication: 'unknown',
    runtime: 'idle',
    error: null,
    reconnectAttempt: 0,
  }

  const publish = () => listeners.forEach((listener) => listener())
  const update = (next: Partial<OwnerRuntimeState>, notifyWaiters = true) => {
    state = { ...state, ...next }
    if (notifyWaiters && state.transport === 'connected') {
      for (const waiter of [...connectionWaiters]) {
        connectionWaiters.delete(waiter)
        waiter.cleanup()
        waiter.resolve()
      }
    } else if (
      notifyWaiters &&
      (state.transport === 'failed' || state.transport === 'disconnected')
    ) {
      for (const waiter of [...connectionWaiters]) {
        connectionWaiters.delete(waiter)
        waiter.cleanup()
        waiter.reject(new OwnerConnectionError(state.error ?? 'Owner connection closed.'))
      }
    }
    publish()
  }

  const waitForConnection = (signal?: AbortSignal) => {
    if (state.transport === 'connected') return Promise.resolve()
    if (state.transport === 'disconnected')
      return Promise.reject(
        new OwnerConnectionError(state.error ?? 'Owner connection is unavailable.'),
      )
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      }
      const onAbort = () => {
        connectionWaiters.delete(waiter)
        waiter.cleanup()
        reject(new OwnerConnectionError('Waiting for Owner connection was cancelled.'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      connectionWaiters.add(waiter)
    })
  }

  const isAuthenticationRejection = () => state.transport === 'connected' && !runtime.authenticated

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
    if (disposed) throw new OwnerConnectionError('Owner runtime controller is closed.')
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
      const message = presentAppError(error, 'Owner connection failed.')
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
    connect: (next) => connectTarget(next),
    retry: async () => {
      if (disposed) throw new OwnerConnectionError('Owner runtime controller is closed.')
      if (!target) throw new OwnerConnectionError('Owner connection target is missing.')
      reconnectAttempt = 0
      await connectTarget(target)
    },
    switchTarget: async (next) => {
      if (disposed) throw new OwnerConnectionError('Owner runtime controller is closed.')
      clearReconnect()
      runtime.close('switch target')
      await connectTarget(next)
    },
    isAuthenticationRejection,
    request: (method, params, requestOptions) => runtime.request(method, params, requestOptions),
    openStream: (request, handlers) => runtime.openStream(request, handlers),
    subscribeNotification: (listener) => {
      const unsubscribe = runtime.subscribeNotification(listener)
      return () => unsubscribe()
    },
    waitForConnection: (signal) => waitForConnection(signal),
    close: (reason = 'closed') => {
      disposed = true
      explicitlyClosed = true
      target = null
      clearReconnect()
      for (const waiter of [...connectionWaiters]) {
        connectionWaiters.delete(waiter)
        waiter.cleanup()
        waiter.reject(new OwnerConnectionError(reason))
      }
      connectionWaiters.clear()
      transportUnsubscribe()
      runtime.close(reason)
      update(
        {
          transport: 'disconnected',
          authentication: 'unknown',
          runtime: 'idle',
          error: null,
          reconnectAttempt: 0,
        },
        false,
      )
      listeners.clear()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
