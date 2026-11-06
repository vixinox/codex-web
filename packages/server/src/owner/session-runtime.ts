import {
  encodeOwnerFrame,
  parseOwnerEventStreamMessage,
  parseOwnerFrame,
  type OwnerFrame,
} from '@codex-web/protocol/owner'
import type { PublicErrorDto } from '@codex-web/telemetry/errors'
import { log } from '../logger.js'
import { OwnerMethodError, projectOwnerError } from './errors.js'
export { OwnerMethodError } from './errors.js'

export type OwnerTransport = {
  kind: 'local' | 'relay'
  origin?: string
  pairedDeviceId?: string
  e2eeVerified?: boolean
  enrollmentCandidate?: boolean
  enrollmentReference?: string
  clientPublicKey?: string
  promote?: (deviceId: string, clientToken: string) => void
  enrollmentTicket?: string
  promoted?: boolean
  send(frame: string | Uint8Array): Promise<void> | void
  close(code?: number, reason?: string): void
  onMessage(listener: (frame: string | Uint8Array) => void): () => void
  onClose(listener: (reason?: string) => void): () => void
}

export class VirtualOwnerTransport implements OwnerTransport {
  readonly kind = 'relay' as const
  pairedDeviceId: string
  readonly e2eeVerified = true
  clientPublicKey?: string
  promote?: (deviceId: string, clientToken: string) => void
  promoted = false
  enrollmentCandidate = false
  enrollmentReference?: string
  private readonly sendFrame: (frame: string | Uint8Array) => void
  private readonly closeTransport: (code?: number, reason?: string) => void
  private readonly messageListeners = new Set<(frame: string | Uint8Array) => void>()
  private readonly closeListeners = new Set<(reason?: string) => void>()
  private closed = false

  constructor(
    pairedDeviceId: string,
    send: (frame: string | Uint8Array) => void,
    close: (code?: number, reason?: string) => void,
  ) {
    this.pairedDeviceId = pairedDeviceId
    this.sendFrame = send
    this.closeTransport = close
  }

  send(frame: string | Uint8Array) {
    if (this.closed) return
    this.sendFrame(frame)
  }

  close(code?: number, reason?: string) {
    if (this.closed) return
    this.closed = true
    this.closeTransport(code, reason)
    for (const listener of this.closeListeners) listener(reason)
    this.messageListeners.clear()
    this.closeListeners.clear()
  }

  onMessage(listener: (frame: string | Uint8Array) => void) {
    if (this.closed) return () => undefined
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onClose(listener: (reason?: string) => void) {
    if (this.closed) {
      listener()
      return () => undefined
    }
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  receive(frame: string | Uint8Array) {
    if (this.closed) return
    for (const listener of this.messageListeners) listener(frame)
  }
}

export type OwnerContext = {
  ownerId: string
  sessionId: string
  sessionToken?: string
  stepUpAt?: number
  clientId: string
  connectionId: string
  transport: { kind: OwnerTransport['kind']; pairedDeviceId?: string }
}

export type OwnerAdmission = {
  ownerId: string
  sessionId: string
  sessionToken?: string
  stepUpAt?: number
}

export type OwnerStream = {
  meta?: unknown
  run(emit: (event: unknown) => Promise<void>, signal: AbortSignal): Promise<void> | void
}

export type OwnerStreamResult = {
  result?: unknown
  stream: OwnerStream
}

export type OwnerMethodContext = {
  readonly owner: OwnerContext | null
  readonly connectionId: string
  readonly transport: OwnerTransport
  readonly signal: AbortSignal
  readonly requestId: string
  readonly enrollmentTicket?: string
  authenticate(admission: OwnerAdmission): Promise<void> | void
  unauthenticate(): void
}

export type OwnerMethodDefinition = {
  access: 'public' | 'local' | 'authenticated'
  timeoutMs?: number
  closeAfterResponse?: boolean
  handle(params: unknown, context: OwnerMethodContext): unknown
}

export type OwnerMethodRegistry = ReadonlyMap<string, OwnerMethodDefinition>

export type OwnerSessionRuntimeOptions = {
  connectionId: string
  capabilities?: string[]
  maxInFlightRequests?: number
  maxQueuedBytes?: number
  defaultRequestTimeoutMs?: number
  resumeSession?: (token: string, transport: OwnerTransport) => Promise<OwnerAdmission | null>
}

type RequestState = {
  controller: AbortController
  timeout: ReturnType<typeof setTimeout>
  abortCode?: 'REQUEST_TIMEOUT' | 'REQUEST_CANCELLED'
}

type StreamState = {
  controller: AbortController
}

const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 32
const DEFAULT_MAX_QUEUED_BYTES = 2 * 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MAX_RETAINED_REQUEST_IDS = 4096
const AUTH_FAILURE: PublicErrorDto = {
  code: 'owner.auth.unauthorized',
  message: 'Authentication is required.',
  retryable: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class OwnerSessionRuntime {
  private readonly transport: OwnerTransport
  private readonly methods: OwnerMethodRegistry
  private readonly options: OwnerSessionRuntimeOptions
  private readonly activeRequests = new Map<string, RequestState>()
  private readonly seenRequestIds = new Set<string>()
  private readonly activeStreams = new Map<string, StreamState>()
  private removeMessageListener: (() => void) | undefined
  private removeCloseListener: (() => void) | undefined
  private sendQueue: Promise<void> = Promise.resolve()
  private queuedBytes = 0
  private session: OwnerAdmission | null = null
  private clientId: string | undefined
  private started = false
  private closed = false

  constructor(
    transport: OwnerTransport,
    methods: OwnerMethodRegistry,
    options: OwnerSessionRuntimeOptions,
  ) {
    this.transport = transport
    this.methods = methods
    this.options = options
  }

  start(): void {
    if (this.started || this.closed) return
    this.started = true
    this.removeMessageListener = this.transport.onMessage((frame) => {
      void this.receive(frame).catch(() => this.shutdown(1011, 'INTERNAL_ERROR'))
    })
    this.removeCloseListener = this.transport.onClose(() => this.shutdown())

    if (
      this.transport.kind === 'relay' &&
      ((!this.transport.pairedDeviceId && !this.transport.enrollmentCandidate) ||
        this.transport.e2eeVerified !== true)
    ) {
      void this.rejectConnection('UNAUTHORIZED', 'Remote admission is not valid.', 1008)
    }
  }

  close(): void {
    this.shutdown(1000, 'closed')
  }

  private async receive(input: string | Uint8Array): Promise<void> {
    if (this.closed) return
    const parsed = parseOwnerFrame(input)
    if (!parsed.ok) {
      const closeCode = 1007
      await this.rejectConnection(parsed.error.code, parsed.error.message, closeCode)
      return
    }
    const frame = parsed.frame
    if (!this.clientId) {
      if (frame.type !== 'hello') {
        await this.rejectConnection('HELLO_REQUIRED', 'Hello must be the first frame.', 1002)
        return
      }
      await this.admit(frame)
      return
    }
    if (frame.type === 'hello') {
      await this.rejectConnection(
        'HELLO_ALREADY_RECEIVED',
        'Hello can only be sent once per connection.',
        1002,
      )
      return
    }
    if (frame.type === 'close') {
      this.shutdown(1000, frame.code)
      return
    }
    if (frame.type === 'cancel') {
      this.cancel(frame.requestId, frame.streamId)
      return
    }
    if (frame.type === 'request') {
      await this.execute(frame.requestId, frame.method, frame.params)
      return
    }
    await this.rejectConnection('INVALID_FRAME', 'Client frame is not valid in this state.', 1002)
  }

  private async admit(frame: Extract<OwnerFrame, { type: 'hello' }>): Promise<void> {
    this.clientId = frame.clientId
    if (frame.sessionToken && this.options.resumeSession) {
      try {
        this.session = await this.options.resumeSession(frame.sessionToken, this.transport)
      } catch {
        this.session = null
      }
      if (this.closed) return
    }
    await this.send({
      type: 'ready',

      connectionId: this.options.connectionId,
      authenticated: this.session !== null,
      capabilities: this.options.capabilities ?? [],
    })
  }

  private async execute(requestId: string, methodName: string, params: unknown): Promise<void> {
    if (this.seenRequestIds.has(requestId)) {
      await this.respondError(requestId, {
        code: 'owner.request.duplicate-id',
        message: 'Request ID has already been used on this connection.',
        retryable: false,
      })
      return
    }
    if (this.seenRequestIds.size >= MAX_RETAINED_REQUEST_IDS) {
      this.shutdown(1008, 'REQUEST_LIMIT_EXCEEDED')
      return
    }
    this.seenRequestIds.add(requestId)

    if (
      this.activeRequests.size >=
      (this.options.maxInFlightRequests ?? DEFAULT_MAX_IN_FLIGHT_REQUESTS)
    ) {
      await this.respondError(requestId, {
        code: 'owner.request.limit-exceeded',
        message: 'Too many requests are active on this connection.',
        retryable: true,
      })
      return
    }

    const method = this.methods.get(methodName)
    if (!method) {
      await this.respondError(requestId, {
        code: 'owner.request.method-not-found',
        message: 'Requested method is not available.',
        retryable: false,
      })
      return
    }
    if (
      this.transport.kind === 'relay' &&
      this.transport.enrollmentCandidate &&
      !this.transport.promoted &&
      !['owner.enrollment.redeem'].includes(methodName)
    ) {
      await this.respondError(requestId, AUTH_FAILURE)
      return
    }
    if (method.access === 'local' && this.transport.kind !== 'local') {
      await this.respondError(requestId, {
        code: 'owner.auth.local-transport-required',
        message: 'This method is only available on a local connection.',
        retryable: false,
      })
      return
    }
    if (method.access === 'authenticated' && !this.session) {
      await this.respondError(requestId, AUTH_FAILURE)
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(
      () => {
        const state = this.activeRequests.get(requestId)
        if (state && !controller.signal.aborted) {
          state.abortCode = 'REQUEST_TIMEOUT'
          controller.abort()
        }
      },
      method.timeoutMs ?? this.options.defaultRequestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    )
    const state: RequestState = { controller, timeout }
    this.activeRequests.set(requestId, state)

    try {
      const context = this.createMethodContext(controller.signal, requestId, params)
      const output = await raceAbort(
        Promise.resolve(method.handle(params, context)),
        controller.signal,
      )
      if (controller.signal.aborted) throw abortError(state.abortCode)

      if (isStreamResult(output)) {
        const streamId = this.newStreamId()
        const streamController = new AbortController()
        this.activeStreams.set(streamId, { controller: streamController })
        await this.send({ type: 'response', requestId, result: output.result ?? null })
        await this.send({
          type: 'stream.open',
          streamId,
          requestId,
          ...(output.stream.meta === undefined ? {} : { meta: output.stream.meta }),
        })
        this.startStream(streamId, output.stream, streamController)
      } else {
        await this.send({ type: 'response', requestId, result: output ?? null })
        if (method.closeAfterResponse || this.transport.promoted)
          this.shutdown(1000, this.transport.promoted ? 'paired' : 'session closed')
      }
    } catch (error) {
      const projectedError = projectError(error, state.abortCode)
      if (methodName.startsWith('owner.passkey.')) {
        log.warn('owner.passkey.method-failed', {
          method: methodName.slice(0, 80),
          code: projectedError.code,
          transport: this.transport.kind,
        })
      }
      await this.respondError(requestId, projectedError)
    } finally {
      clearTimeout(timeout)
      this.activeRequests.delete(requestId)
    }
  }

  private createMethodContext(
    signal: AbortSignal,
    requestId: string,
    params: unknown,
  ): OwnerMethodContext {
    const owner = () => (this.session ? this.ownerContext() : null)
    return {
      get owner() {
        return owner()
      },
      transport: this.transport,
      connectionId: this.options.connectionId,
      signal,
      requestId,
      ...(this.transport.enrollmentTicket
        ? { enrollmentTicket: this.transport.enrollmentTicket }
        : isRecord(params) && typeof params.ticket === 'string'
          ? { enrollmentTicket: params.ticket }
          : {}),
      authenticate: async (admission) => {
        if (
          this.transport.kind === 'relay' &&
          ((!this.transport.pairedDeviceId && !this.transport.enrollmentCandidate) ||
            this.transport.e2eeVerified !== true)
        ) {
          throw new OwnerMethodError('UNAUTHORIZED')
        }
        if (!admission.ownerId || !admission.sessionId) throw new OwnerMethodError('UNAUTHORIZED')
        this.session = admission
      },
      unauthenticate: () => {
        this.session = null
      },
    }
  }

  private ownerContext(): OwnerContext {
    return {
      ...this.session!,
      clientId: this.clientId!,
      connectionId: this.options.connectionId,
      transport: {
        kind: this.transport.kind,
        ...(this.transport.pairedDeviceId ? { pairedDeviceId: this.transport.pairedDeviceId } : {}),
      },
    }
  }

  private startStream(streamId: string, stream: OwnerStream, controller: AbortController): void {
    const emit = async (event: unknown) => {
      if (controller.signal.aborted || this.closed) return
      const parsedEvent = parseOwnerEventStreamMessage(event)
      if (!parsedEvent.ok) {
        log.warn('owner.stream.event-rejected', { code: parsedEvent.error.code })
        controller.abort()
        await this.send({
          type: 'stream.close',
          streamId,
          reason: parsedEvent.error.code,
        })
        return
      }
      await this.send({ type: 'stream.event', streamId, event: parsedEvent.message })
    }
    void Promise.resolve()
      .then(() => stream.run(emit, controller.signal))
      .then(async () => {
        if (!this.activeStreams.delete(streamId)) return undefined
        await this.send({
          type: 'stream.close',
          streamId,
          ...(controller.signal.aborted ? { reason: 'REQUEST_CANCELLED' } : {}),
        })
        return undefined
      })
      .catch(async () => {
        if (!this.closed && this.activeStreams.delete(streamId)) {
          await this.send({ type: 'stream.close', streamId, reason: 'INTERNAL_ERROR' })
        }
        return undefined
      })
  }

  private cancel(requestId?: string, streamId?: string): void {
    if (requestId) {
      const request = this.activeRequests.get(requestId)
      if (request && !request.controller.signal.aborted) {
        request.abortCode = 'REQUEST_CANCELLED'
        request.controller.abort()
      }
      return
    }
    if (streamId) {
      const stream = this.activeStreams.get(streamId)
      if (stream && !stream.controller.signal.aborted) {
        stream.controller.abort()
        this.activeStreams.delete(streamId)
        void this.send({ type: 'stream.close', streamId, reason: 'REQUEST_CANCELLED' })
      }
    }
  }

  private async respondError(requestId: string, error: PublicErrorDto): Promise<void> {
    await this.send({ type: 'response', requestId, error })
  }

  private newStreamId(): string {
    let id: string
    do {
      id = `s${crypto.randomUUID()}`
    } while (this.activeStreams.has(id))
    return id
  }

  private async send(frame: OwnerFrame): Promise<void> {
    if (this.closed) return
    const encoded = encodeOwnerFrame(frame)
    const bytes = new TextEncoder().encode(encoded).byteLength
    if (this.queuedBytes + bytes > (this.options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES)) {
      this.shutdown(1013, 'BACKPRESSURE_LIMIT_EXCEEDED')
      return
    }

    this.queuedBytes += bytes
    const queued = this.sendQueue
      .then(() => (this.closed ? undefined : this.transport.send(encoded)))
      .catch(() => this.shutdown(1011, 'SEND_FAILED'))
      .finally(() => {
        this.queuedBytes -= bytes
      })
    this.sendQueue = queued
    await queued
  }

  private async rejectConnection(code: string, message: string, closeCode: number): Promise<void> {
    if (this.closed) return
    await this.send({ type: 'close', code, message }).catch(() => undefined)
    this.shutdown(closeCode, code)
  }

  private shutdown(code?: number, reason?: string): void {
    if (this.closed) return
    this.closed = true
    this.removeMessageListener?.()
    this.removeCloseListener?.()
    for (const request of this.activeRequests.values()) {
      clearTimeout(request.timeout)
      if (!request.controller.signal.aborted) request.controller.abort()
    }
    for (const stream of this.activeStreams.values()) {
      if (!stream.controller.signal.aborted) stream.controller.abort()
    }
    this.activeRequests.clear()
    this.activeStreams.clear()
    this.transport.close(code, reason)
  }
}

function isStreamResult(value: unknown): value is OwnerStreamResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'stream' in value &&
    typeof value.stream === 'object' &&
    value.stream !== null &&
    'run' in value.stream &&
    typeof value.stream.run === 'function'
  )
}

function projectError(
  error: unknown,
  abortCode?: 'REQUEST_TIMEOUT' | 'REQUEST_CANCELLED',
): PublicErrorDto {
  if (abortCode)
    return projectOwnerError(new OwnerMethodError(abortCode, abortCode === 'REQUEST_TIMEOUT'))
  return projectOwnerError(error)
}

function abortError(code?: RequestState['abortCode']): Error {
  return new OwnerMethodError(code ?? 'REQUEST_CANCELLED', code === 'REQUEST_TIMEOUT')
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
        return value
      },
      (error: unknown) => {
        cleanup()
        reject(error)
        return undefined
      },
    )
  })
}
