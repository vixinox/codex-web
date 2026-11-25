import {
  OWNER_MAX_FRAME_BYTES,
  parseOwnerEventStreamMessage,
  parseOwnerFrame,
  type OwnerFrame,
} from '@codex-web/protocol/owner'
import type { OwnerErrorDto } from '@codex-web/telemetry/errors'
import { log } from '../logger.js'
import { OwnerMethodError } from './errors.js'
import { isStreamResult, projectError, abortError, raceAbort } from './session/request.js'
import type {
  OwnerAdmission,
  OwnerContext,
  OwnerMethodContext,
  OwnerMethodRegistry,
  OwnerSessionRuntimeOptions,
  OwnerStream,
  OwnerTransport,
} from './session/contracts.js'
import { OrderedOwnerSender } from './session/ordered-sender.js'
export { OwnerMethodError } from './errors.js'
export type {
  OwnerAdmission,
  OwnerContext,
  OwnerMethodContext,
  OwnerMethodDefinition,
  OwnerMethodRegistry,
  OwnerSessionRuntimeOptions,
  OwnerStream,
  OwnerStreamResult,
  OwnerTransport,
} from './session/contracts.js'
export { VirtualOwnerTransport } from './session/virtual-transport.js'

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
const AUTH_FAILURE: OwnerErrorDto = {
  code: 'owner.auth.unauthorized',
  message: 'Authentication is required.',
  retryable: false,
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
  private readonly sender: OrderedOwnerSender
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
    this.sender = new OrderedOwnerSender(
      transport,
      options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES,
      (code, reason) => this.shutdown(code, reason),
    )
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
    if (this.transport.kind === 'local' && this.options.localAdmission) {
      this.session = this.options.localAdmission
    } else if (
      this.transport.kind === 'relay' &&
      frame.sessionToken &&
      this.options.resumeSession
    ) {
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
      ...(this.session ? { ownerId: this.session.ownerId } : {}),
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

    const authenticatedAtStart = method.access === 'authenticated' && this.session !== null
    try {
      const context = this.createMethodContext(controller.signal, requestId)
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
      const projectedError = projectError(error, state.abortCode, authenticatedAtStart)
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

  private createMethodContext(signal: AbortSignal, requestId: string): OwnerMethodContext {
    const owner = () => (this.session ? this.ownerContext() : null)
    return {
      get owner() {
        return owner()
      },
      transport: this.transport,
      connectionId: this.options.connectionId,
      signal,
      requestId,
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

  private async respondError(requestId: string, error: OwnerErrorDto): Promise<void> {
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
    const encoded = JSON.stringify(frame)
    const bytes = new TextEncoder().encode(encoded).byteLength
    if (bytes > OWNER_MAX_FRAME_BYTES) {
      if (frame.type === 'response') {
        await this.send({
          type: 'response',
          requestId: frame.requestId,
          error: {
            code: 'owner.protocol.frame-too-large',
            retryable: false,
            message: 'Owner response exceeds the frame size limit.',
          },
        })
      } else if (frame.type === 'stream.event') {
        this.activeStreams.get(frame.streamId)?.controller.abort()
        this.activeStreams.delete(frame.streamId)
        await this.send({
          type: 'stream.close',
          streamId: frame.streamId,
          reason: 'FRAME_TOO_LARGE',
        })
      } else this.shutdown(1009, 'FRAME_TOO_LARGE')
      return
    }
    const parsed = parseOwnerFrame(encoded)
    if (!parsed.ok) throw new TypeError(parsed.error.message)
    await this.sender.send(encoded, bytes)
  }

  private async rejectConnection(code: string, message: string, closeCode: number): Promise<void> {
    if (this.closed) return
    await this.send({ type: 'close', code, message }).catch(() => undefined)
    this.shutdown(closeCode, code)
  }

  private shutdown(code?: number, reason?: string): void {
    if (this.closed) return
    this.closed = true
    this.sender.close()
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
