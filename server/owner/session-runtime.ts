import {
  encodeOwnerFrame,
  parseOwnerFrame,
  type OwnerError,
  type OwnerErrorCode,
  type OwnerFrame,
} from '../../packages/owner-protocol/src/index.js'

export type OwnerTransport = {
  kind: 'local' | 'relay'
  pairedDeviceId?: string
  e2eeVerified?: boolean
  send(frame: string | Uint8Array): Promise<void> | void
  close(code?: number, reason?: string): void
  onMessage(listener: (frame: string | Uint8Array) => void): () => void
  onClose(listener: (reason?: string) => void): () => void
}

export type OwnerContext = {
  ownerId: string
  sessionId: string
  clientId: string
  connectionId: string
  transport: { kind: OwnerTransport['kind']; pairedDeviceId?: string }
}

export type OwnerAdmission = {
  ownerId: string
  sessionId: string
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
  readonly transport: OwnerTransport
  readonly signal: AbortSignal
  authenticate(admission: OwnerAdmission): void
}

export type OwnerMethodDefinition = {
  access: 'public' | 'local' | 'authenticated'
  timeoutMs?: number
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
const MAX_RETAINED_REQUEST_IDS = 100_000
const AUTH_FAILURE: OwnerError = {
  code: 'UNAUTHORIZED',
  message: 'Authentication is required.',
  retryable: false,
}

export class OwnerMethodError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, retryable = false) {
    super(code)
    this.name = 'OwnerMethodError'
    this.code = code
    this.retryable = retryable
  }
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
      (!this.transport.pairedDeviceId || this.transport.e2eeVerified !== true)
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
      const closeCode = parsed.error.code === 'UNSUPPORTED_VERSION' ? 1002 : 1007
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
      version: 1,
      connectionId: this.options.connectionId,
      authenticated: this.session !== null,
      capabilities: this.options.capabilities ?? [],
    })
  }

  private async execute(requestId: string, methodName: string, params: unknown): Promise<void> {
    if (this.seenRequestIds.has(requestId)) {
      await this.respondError(requestId, {
        code: 'DUPLICATE_REQUEST_ID',
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
        code: 'REQUEST_LIMIT_EXCEEDED',
        message: 'Too many requests are active on this connection.',
        retryable: true,
      })
      return
    }

    const method = this.methods.get(methodName)
    if (!method) {
      await this.respondError(requestId, {
        code: 'METHOD_NOT_FOUND',
        message: 'Requested method is not available.',
        retryable: false,
      })
      return
    }
    if (method.access === 'local' && this.transport.kind !== 'local') {
      await this.respondError(requestId, {
        code: 'LOCAL_TRANSPORT_REQUIRED',
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
      const context = this.createMethodContext(controller.signal)
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
      }
    } catch (error) {
      const safeError = projectError(error, state.abortCode)
      await this.respondError(requestId, safeError)
    } finally {
      clearTimeout(timeout)
      this.activeRequests.delete(requestId)
    }
  }

  private createMethodContext(signal: AbortSignal): OwnerMethodContext {
    const owner = () => (this.session ? this.ownerContext() : null)
    return {
      get owner() {
        return owner()
      },
      transport: this.transport,
      signal,
      authenticate: (admission) => {
        if (
          this.transport.kind === 'relay' &&
          (!this.transport.pairedDeviceId || this.transport.e2eeVerified !== true)
        ) {
          throw new OwnerMethodError('UNAUTHORIZED')
        }
        if (!admission.ownerId || !admission.sessionId) throw new OwnerMethodError('UNAUTHORIZED')
        this.session = admission
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
      await this.send({ type: 'stream.event', streamId, event })
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

  private async respondError(requestId: string, error: OwnerError): Promise<void> {
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
): OwnerError {
  if (abortCode === 'REQUEST_TIMEOUT') {
    return { code: 'REQUEST_TIMEOUT', message: 'Request timed out.', retryable: true }
  }
  if (abortCode === 'REQUEST_CANCELLED') {
    return { code: 'REQUEST_CANCELLED', message: 'Request was cancelled.', retryable: false }
  }
  if (error instanceof OwnerMethodError) {
    const code = isOwnerErrorCode(error.code) ? error.code : 'INTERNAL_ERROR'
    return { code, message: SAFE_ERROR_MESSAGES[code], retryable: error.retryable }
  }
  return { code: 'INTERNAL_ERROR', message: 'Request failed.', retryable: true }
}

function abortError(code?: RequestState['abortCode']): Error {
  return new OwnerMethodError(code ?? 'REQUEST_CANCELLED', code === 'REQUEST_TIMEOUT')
}

const SAFE_ERROR_MESSAGES: Record<OwnerErrorCode, string> = {
  INVALID_JSON: 'Frame is not valid JSON.',
  INVALID_FRAME: 'Frame is invalid.',
  UNSUPPORTED_FRAME: 'Frame type is not supported.',
  UNSUPPORTED_VERSION: 'Protocol version is not supported.',
  FRAME_TOO_LARGE: 'Frame exceeds the maximum size.',
  NON_TEXT_FRAME: 'Text frames are required.',
  INVALID_HELLO: 'Hello frame is invalid.',
  HELLO_REQUIRED: 'Hello must be the first frame.',
  HELLO_ALREADY_RECEIVED: 'Hello can only be sent once per connection.',
  UNAUTHORIZED: 'Authentication is required.',
  LOCAL_TRANSPORT_REQUIRED: 'This method is only available on a local connection.',
  DUPLICATE_REQUEST_ID: 'Request ID has already been used on this connection.',
  REQUEST_LIMIT_EXCEEDED: 'Too many requests are active on this connection.',
  REQUEST_TIMEOUT: 'Request timed out.',
  REQUEST_CANCELLED: 'Request was cancelled.',
  METHOD_NOT_FOUND: 'Requested method is not available.',
  INVALID_PARAMS: 'Request parameters are invalid.',
  INTERNAL_ERROR: 'Request failed.',
  BACKPRESSURE_LIMIT_EXCEEDED: 'Connection send queue exceeded its limit.',
  SUBSCRIPTION_EXPIRED: 'Event subscription has expired.',
  INVALID_EVENT_CURSOR: 'Event cursor is invalid.',
  OWNER_ALREADY_EXISTS: 'An Owner account already exists.',
  AUTH_FAILURE: 'Authentication failed.',
  CODEX_UNAVAILABLE: 'Codex is unavailable.',
  RESOURCE_NOT_FOUND: 'Requested resource was not found.',
}

function isOwnerErrorCode(code: string): code is OwnerErrorCode {
  return Object.hasOwn(SAFE_ERROR_MESSAGES, code)
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
