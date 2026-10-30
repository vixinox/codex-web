import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeOwnerFrame, type OwnerFrame } from '@codex-web/protocol/owner'
import {
  OwnerSessionRuntime,
  VirtualOwnerTransport,
  type OwnerTransport,
} from './session-runtime.js'

class FakeTransport implements OwnerTransport {
  readonly sent: string[] = []
  closed: { code?: number; reason?: string } | undefined
  pairedDeviceId?: string
  e2eeVerified?: boolean
  loginCandidate?: boolean
  kind: 'local' | 'relay' = 'local'
  private messageListener: ((frame: string | Uint8Array) => void) | undefined
  private closeListener: ((reason?: string) => void) | undefined
  sendGate: Promise<void> | undefined

  send(frame: string | Uint8Array): Promise<void> {
    this.sent.push(String(frame))
    return this.sendGate ?? Promise.resolve()
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
    this.closeListener?.(reason)
  }

  onMessage(listener: (frame: string | Uint8Array) => void): () => void {
    this.messageListener = listener
    return () => (this.messageListener = undefined)
  }

  onClose(listener: (reason?: string) => void): () => void {
    this.closeListener = listener
    return () => (this.closeListener = undefined)
  }

  receive(frame: OwnerFrame | string | Uint8Array): void {
    const encoded =
      typeof frame === 'string' || frame instanceof Uint8Array ? frame : encodeOwnerFrame(frame)
    this.messageListener?.(encoded)
  }
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > 1000)
        return reject(new Error('Timed out waiting for fake transport.'))
      setTimeout(poll, 1)
    }
    poll()
  })
}

function readFrames(transport: FakeTransport): OwnerFrame[] {
  return transport.sent.map((frame) => JSON.parse(frame) as OwnerFrame)
}

function createRuntime(
  transport: FakeTransport,
  methods: ConstructorParameters<typeof OwnerSessionRuntime>[1],
  options: Partial<ConstructorParameters<typeof OwnerSessionRuntime>[2]> = {},
) {
  const runtime = new OwnerSessionRuntime(transport, methods, {
    connectionId: 'connection-1',
    ...options,
  })
  runtime.start()
  return runtime
}

test('requires hello first, rejects unsupported versions, and resumes sessions before ready', async () => {
  const transport = new FakeTransport()
  createRuntime(transport, new Map(), {
    resumeSession: async (token) =>
      token === 'valid' ? { ownerId: 'owner-1', sessionId: 's1' } : null,
  })
  transport.receive({ type: 'request', requestId: 'r1', method: 'owner.status' })
  await waitFor(() => transport.closed !== undefined)
  assert.equal(readFrames(transport)[0]?.type, 'close')

  const versionTransport = new FakeTransport()
  createRuntime(versionTransport, new Map())
  versionTransport.receive(
    JSON.stringify({ type: 'hello', version: 99, clientId: 'c1', capabilities: [] }),
  )
  await waitFor(() => versionTransport.closed !== undefined)
  assert.deepEqual(readFrames(versionTransport)[0], {
    type: 'close',
    code: 'UNSUPPORTED_VERSION',
    message: 'Protocol version is not supported.',
  })

  const resumedTransport = new FakeTransport()
  createRuntime(resumedTransport, new Map(), {
    resumeSession: async (token) =>
      token === 'valid' ? { ownerId: 'owner-1', sessionId: 's1' } : null,
  })
  resumedTransport.receive({
    type: 'hello',
    version: 1,
    clientId: 'c1',
    capabilities: ['threads'],
    sessionToken: 'valid',
  })
  await waitFor(() => readFrames(resumedTransport).some((frame) => frame.type === 'ready'))
  assert.deepEqual(readFrames(resumedTransport)[0], {
    type: 'ready',
    version: 1,
    connectionId: 'connection-1',
    authenticated: true,
    capabilities: [],
  })
})

test('gates local and authenticated methods and prevents request replay', async () => {
  const transport = new FakeTransport()
  let calls = 0
  const runtime = createRuntime(
    transport,
    new Map([
      [
        'owner.session.open',
        {
          access: 'public',
          handle: (_params, context) => {
            context.authenticate({ ownerId: 'owner-1', sessionId: 'session-1' })
            return { opened: true }
          },
        },
      ],
      ['local.only', { access: 'local', handle: () => ({ ok: true }) }],
      ['private.read', { access: 'authenticated', handle: () => ({ secret: 'projected' }) }],
      [
        'broken.read',
        {
          access: 'public',
          handle: () => {
            throw new Error('apiKey=sk-secret /home/owner/.codex')
          },
        },
      ],
      ['counter.next', { access: 'public', handle: () => ({ count: ++calls }) }],
    ]),
  )
  transport.receive({ type: 'hello', version: 1, clientId: 'client-1', capabilities: [] })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'ready'))

  transport.receive({ type: 'request', requestId: 'private-1', method: 'private.read' })
  transport.receive({ type: 'request', requestId: 'local-1', method: 'local.only' })
  await waitFor(
    () => readFrames(transport).filter((frame) => frame.type === 'response').length === 2,
  )
  assert.deepEqual(
    readFrames(transport)
      .filter((frame) => frame.type === 'response')
      .map((frame) => (frame.type === 'response' ? frame.error?.code : null)),
    ['UNAUTHORIZED', undefined],
  )

  transport.receive({ type: 'request', requestId: 'open-1', method: 'owner.session.open' })
  await waitFor(() =>
    readFrames(transport).some(
      (frame) => frame.type === 'response' && frame.requestId === 'open-1',
    ),
  )
  transport.receive({ type: 'request', requestId: 'private-2', method: 'private.read' })
  transport.receive({ type: 'request', requestId: 'broken-1', method: 'broken.read' })
  transport.receive({ type: 'request', requestId: 'counter-1', method: 'counter.next' })
  transport.receive({ type: 'request', requestId: 'counter-1', method: 'counter.next' })
  await waitFor(
    () =>
      readFrames(transport).filter(
        (frame) => frame.type === 'response' && frame.requestId === 'counter-1',
      ).length === 2,
  )
  assert.equal(calls, 1)
  const brokenResponse = readFrames(transport).find(
    (frame) => frame.type === 'response' && frame.requestId === 'broken-1',
  )
  assert.ok(brokenResponse && brokenResponse.type === 'response')
  assert.deepEqual(brokenResponse.error, {
    code: 'INTERNAL_ERROR',
    message: 'Request failed.',
    retryable: true,
  })
  assert.equal(transport.sent.join('').includes('sk-secret'), false)
  assert.equal(transport.sent.join('').includes('/home/owner'), false)
  assert.equal(runtime !== undefined, true)
})

test('keeps an encrypted login candidate limited to authentication methods', async () => {
  const transport = new FakeTransport()
  transport.kind = 'relay'
  transport.e2eeVerified = true
  transport.loginCandidate = true
  let businessCalls = 0
  createRuntime(
    transport,
    new Map([
      ['owner.status', { access: 'public' as const, handle: () => ({ ownerExists: true }) }],
      ['threads.list', { access: 'authenticated' as const, handle: () => ++businessCalls }],
    ]),
  )
  transport.receive({ type: 'hello', version: 1, clientId: 'login-1', capabilities: [] })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'ready'))
  transport.receive({ type: 'request', requestId: 'business-1', method: 'threads.list' })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'response'))
  const response = readFrames(transport).find((frame) => frame.type === 'response')
  assert.equal(response?.type, 'response')
  if (response?.type === 'response') assert.equal(response.error?.code, 'UNAUTHORIZED')
  assert.equal(businessCalls, 0)
})

test('rejects invalid session resumption before accessing Owner methods', async () => {
  const transport = new FakeTransport()
  let businessCalls = 0
  createRuntime(
    transport,
    new Map([
      [
        'owner.security.status',
        { access: 'local' as const, handle: () => ({ initialized: false }) },
      ],
      ['projects.list', { access: 'authenticated' as const, handle: () => ++businessCalls }],
    ]),
    {
      resumeSession: async () => null,
    },
  )
  transport.receive({
    type: 'hello',
    version: 1,
    clientId: 'setup-client',
    capabilities: [],
    sessionToken: 'setup-token',
  })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'ready'))
  transport.receive({ type: 'request', requestId: 'security-1', method: 'owner.security.status' })
  transport.receive({ type: 'request', requestId: 'business-1', method: 'projects.list' })
  await waitFor(
    () => readFrames(transport).filter((frame) => frame.type === 'response').length === 2,
  )
  const response = readFrames(transport).find(
    (frame) => frame.type === 'response' && frame.requestId === 'business-1',
  )
  assert.ok(response && response.type === 'response')
  assert.equal(response.error?.code, 'UNAUTHORIZED')
  assert.equal(businessCalls, 0)
})

test('opens and explicitly cancels a stream, then cleans active work on disconnect', async () => {
  const transport = new FakeTransport()
  let signal: AbortSignal | undefined
  createRuntime(
    transport,
    new Map([
      [
        'events.subscribe',
        {
          access: 'authenticated',
          handle: (_params, context) => ({
            result: { subscriptionId: 'sub-1' },
            stream: {
              meta: { subscriptionId: 'sub-1' },
              run: async (emit, streamSignal) => {
                signal = streamSignal
                await emit({ event: 'first' })
                await new Promise<void>((resolve) =>
                  streamSignal.addEventListener('abort', () => resolve(), { once: true }),
                )
              },
            },
          }),
        },
      ],
    ]),
    {
      resumeSession: async () => ({ ownerId: 'owner-1', sessionId: 'session-1' }),
    },
  )
  transport.receive({
    type: 'hello',
    version: 1,
    clientId: 'client-1',
    capabilities: [],
    sessionToken: 'x',
  })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'ready'))
  transport.receive({ type: 'request', requestId: 'events-1', method: 'events.subscribe' })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'stream.event'))
  const open = readFrames(transport).find((frame) => frame.type === 'stream.open')
  assert.ok(open && open.type === 'stream.open')
  transport.receive({ type: 'cancel', streamId: open.streamId })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'stream.close'))
  assert.equal(signal?.aborted, true)

  const disconnectTransport = new FakeTransport()
  let requestSignal: AbortSignal | undefined
  createRuntime(
    disconnectTransport,
    new Map([
      [
        'pending.read',
        {
          access: 'authenticated',
          handle: (_params, context) => {
            requestSignal = context.signal
            return new Promise((resolve) =>
              context.signal.addEventListener('abort', () => resolve(null), { once: true }),
            )
          },
        },
      ],
    ]),
    { resumeSession: async () => ({ ownerId: 'owner-1', sessionId: 'session-1' }) },
  )
  disconnectTransport.receive({
    type: 'hello',
    version: 1,
    clientId: 'client-1',
    capabilities: [],
    sessionToken: 'valid',
  })
  await waitFor(() => readFrames(disconnectTransport).some((frame) => frame.type === 'ready'))
  disconnectTransport.receive({ type: 'request', requestId: 'pending-1', method: 'pending.read' })
  await waitFor(() => requestSignal !== undefined)
  disconnectTransport.close(1000, 'client disconnected')
  assert.equal(requestSignal?.aborted, true)
})

test('times out methods and closes when slow consumers exceed the send queue limit', async () => {
  const timeoutTransport = new FakeTransport()
  createRuntime(
    timeoutTransport,
    new Map([
      [
        'slow',
        {
          access: 'public',
          handle: (_params, context) =>
            new Promise((resolve) =>
              context.signal.addEventListener('abort', () => resolve('late'), { once: true }),
            ),
        },
      ],
    ]),
    { defaultRequestTimeoutMs: 10 },
  )
  timeoutTransport.receive({ type: 'hello', version: 1, clientId: 'c1', capabilities: [] })
  await waitFor(() => readFrames(timeoutTransport).some((frame) => frame.type === 'ready'))
  timeoutTransport.receive({ type: 'request', requestId: 'timeout-1', method: 'slow' })
  await waitFor(() =>
    readFrames(timeoutTransport).some(
      (frame) => frame.type === 'response' && frame.requestId === 'timeout-1',
    ),
  )
  assert.equal(
    readFrames(timeoutTransport).find(
      (frame) => frame.type === 'response' && frame.requestId === 'timeout-1',
    )?.type === 'response'
      ? (
          readFrames(timeoutTransport).find(
            (frame) => frame.type === 'response' && frame.requestId === 'timeout-1',
          ) as Extract<OwnerFrame, { type: 'response' }>
        ).error?.code
      : null,
    'REQUEST_TIMEOUT',
  )

  const slowTransport = new FakeTransport()
  slowTransport.sendGate = new Promise<void>(() => undefined)
  createRuntime(slowTransport, new Map(), { maxQueuedBytes: 50 })
  slowTransport.receive({ type: 'hello', version: 1, clientId: 'c1', capabilities: [] })
  await waitFor(() => slowTransport.closed !== undefined)
  assert.equal(slowTransport.closed?.reason, 'BACKPRESSURE_LIMIT_EXCEEDED')
})

test('limits in-flight requests and cancels only the explicitly targeted request', async () => {
  const transport = new FakeTransport()
  let firstSignal: AbortSignal | undefined
  createRuntime(
    transport,
    new Map([
      [
        'slow',
        {
          access: 'public',
          handle: (_params, context) => {
            firstSignal = context.signal
            return new Promise((resolve) =>
              context.signal.addEventListener('abort', () => resolve(null), { once: true }),
            )
          },
        },
      ],
      ['fast', { access: 'public', handle: () => ({ ok: true }) }],
    ]),
    { maxInFlightRequests: 1 },
  )
  transport.receive({ type: 'hello', version: 1, clientId: 'c1', capabilities: [] })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'ready'))
  transport.receive({ type: 'request', requestId: 'slow-1', method: 'slow' })
  await waitFor(() => firstSignal !== undefined)
  transport.receive({ type: 'request', requestId: 'fast-1', method: 'fast' })
  await waitFor(() =>
    readFrames(transport).some(
      (frame) => frame.type === 'response' && frame.requestId === 'fast-1',
    ),
  )
  const limited = readFrames(transport).find(
    (frame) => frame.type === 'response' && frame.requestId === 'fast-1',
  )
  assert.ok(limited && limited.type === 'response')
  assert.equal(limited.error?.code, 'REQUEST_LIMIT_EXCEEDED')
  assert.equal(firstSignal?.aborted, false)

  transport.receive({ type: 'cancel', requestId: 'slow-1' })
  await waitFor(() =>
    readFrames(transport).some(
      (frame) => frame.type === 'response' && frame.requestId === 'slow-1',
    ),
  )
  assert.equal(firstSignal?.aborted, true)
  const cancelled = readFrames(transport).find(
    (frame) => frame.type === 'response' && frame.requestId === 'slow-1',
  )
  assert.ok(cancelled && cancelled.type === 'response')
  assert.equal(cancelled.error?.code, 'REQUEST_CANCELLED')
})

test('rejects relay transports before hello unless pairing and E2EE are verified', async () => {
  const transport = new FakeTransport()
  transport.kind = 'relay'
  createRuntime(transport, new Map())
  await waitFor(() => transport.closed !== undefined)
  assert.equal(transport.closed?.reason, 'UNAUTHORIZED')
})

test('keeps session close explicit and closes the socket after the response', async () => {
  const transport = new FakeTransport()
  createRuntime(
    transport,
    new Map([
      [
        'owner.session.close',
        {
          access: 'authenticated' as const,
          closeAfterResponse: true,
          handle: () => ({ closed: true }),
        },
      ],
    ]),
    { resumeSession: async () => ({ ownerId: 'owner-1', sessionId: 'session-1' }) },
  )
  transport.receive({
    type: 'hello',
    version: 1,
    clientId: 'client-1',
    capabilities: [],
    sessionToken: 'opaque-token',
  })
  await waitFor(() => readFrames(transport).some((frame) => frame.type === 'ready'))
  transport.receive({ type: 'request', requestId: 'close-1', method: 'owner.session.close' })
  await waitFor(() => transport.closed !== undefined)
  assert.equal(transport.closed?.code, 1000)
  assert.ok(readFrames(transport).some((frame) => frame.type === 'response'))
})

test('virtual remote transport binds verified device identity and carries frames both ways', () => {
  const sent: Array<string | Uint8Array> = []
  const closed: Array<{ code?: number; reason?: string }> = []
  const transport = new VirtualOwnerTransport(
    'device-1',
    (frame) => sent.push(frame),
    (code, reason) => closed.push({ code, reason }),
  )
  let received: string | Uint8Array | undefined
  let closeReason: string | undefined
  transport.onMessage((frame) => (received = frame))
  transport.onClose((reason) => (closeReason = reason))
  transport.receive('owner-request')
  transport.send('owner-response')
  transport.close(1000, 'revoked')

  assert.equal(transport.kind, 'relay')
  assert.equal(transport.pairedDeviceId, 'device-1')
  assert.equal(transport.e2eeVerified, true)
  assert.equal(received, 'owner-request')
  assert.deepEqual(sent, ['owner-response'])
  assert.deepEqual(closed, [{ code: 1000, reason: 'revoked' }])
  assert.equal(closeReason, 'revoked')
  transport.receive('ignored')
  assert.equal(received, 'owner-request')
})
