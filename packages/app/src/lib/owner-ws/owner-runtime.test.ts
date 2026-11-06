import { describe, expect, it, vi } from 'vitest'
import { encodeOwnerFrame, parseOwnerFrame } from '@codex-web/protocol/owner'
import { TelemetryErrorCode } from '@codex-web/telemetry/errors'
import { OwnerRequestError } from './owner-runtime'
import { createOwnerRuntime, OwnerLocalRequestError } from './owner-runtime'

class FakeSocket {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  sent: string[] = []
  send = (value: string) => this.sent.push(value)
  close = vi.fn(() => {
    this.readyState = 3
  })
  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  receive(frame: Parameters<typeof encodeOwnerFrame>[0]) {
    this.onmessage?.({ data: encodeOwnerFrame(frame) } as MessageEvent)
  }
  last() {
    return parseOwnerFrame(this.sent.at(-1) ?? '')
  }
}

function ready(socket: FakeSocket) {
  socket.receive({
    type: 'ready',

    connectionId: 'connection-1',
    authenticated: true,
    capabilities: ['owner'],
  })
}

describe('Owner runtime transport', () => {
  it('performs hello and resolves requests', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    expect(socket.last()).toMatchObject({ ok: true, frame: { type: 'hello' } })
    ready(socket)
    await connection
    const result = runtime.request<{ ok: boolean }>('owner.status')
    const sent = socket.last()
    expect(sent).toMatchObject({ ok: true, frame: { type: 'request', method: 'owner.status' } })
    if (!sent.ok || sent.frame.type !== 'request') throw new Error('request not sent')
    socket.receive({ type: 'response', requestId: sent.frame.requestId, result: { ok: true } })
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('rejects an Owner handshake close without leaving connection pending', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    socket.receive({
      type: 'close',
      code: 'INVALID_HELLO',
      message: 'Hello frame is invalid.',
    })
    await expect(connection).rejects.toMatchObject({
      code: 'app.owner.connection.unavailable',
    })
    expect(runtime.state).toBe('disconnected')
  })

  it('fails active streams when the Owner sends an invalid event frame', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    ready(socket)
    await connection
    const onError = vi.fn()
    const onClose = vi.fn()
    runtime.openStream({ method: 'events.subscribe' }, { onEvent: vi.fn(), onError, onClose })
    socket.receive({
      type: 'stream.open',
      streamId: 'stream-1',
      requestId: 'owner-1',
    })
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'stream.event',
        streamId: 'stream-1',
        event: {
          cursor: { epoch: 'epoch-1', sequence: 1 },
          event: { method: 'legacy', params: {} },
        },
      }),
    } as MessageEvent)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'app.owner.protocol.invalid-frame' }),
    )
    expect(onClose).toHaveBeenCalledWith('CONNECTION_CLOSED')
  })

  it('reports contract failure before close so recovery cannot race the terminal error', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    ready(socket)
    await connection
    const calls: string[] = []
    runtime.openStream(
      { method: 'events.subscribe' },
      {
        onEvent: vi.fn(),
        onError: () => calls.push('error'),
        onClose: () => calls.push('close'),
      },
    )
    const request = socket.last()
    if (!request.ok || request.frame.type !== 'request') throw new Error('request missing')
    socket.receive({
      type: 'stream.open',
      streamId: 'stream-contract',
      requestId: request.frame.requestId,
    })
    socket.receive({
      type: 'stream.close',
      streamId: 'stream-contract',
      reason: 'INVALID_STREAM_EVENT',
    })
    expect(calls).toEqual(['error', 'close'])
    runtime.close()
  })

  it('rejects pending requests and closes streams', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    ready(socket)
    await connection
    const request = runtime.request('threads.list')
    const onClose = vi.fn()
    runtime.openStream({ method: 'events.subscribe' }, { onEvent: vi.fn(), onClose })
    runtime.close()
    await expect(request).rejects.toBeInstanceOf(Error)
    expect(onClose).toHaveBeenCalledWith('CONNECTION_CLOSED')
    expect(runtime.state).toBe('disconnected')
  })

  it('cancels a timed out request', async () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    ready(socket)
    await connection
    const request = runtime.request('threads.list', undefined, { timeoutMs: 10 })
    const rejected = expect(request).rejects.toBeInstanceOf(OwnerLocalRequestError)
    await vi.advanceTimersByTimeAsync(11)
    await rejected
    expect(socket.sent.some((value) => value.includes('"type":"cancel"'))).toBe(true)
    vi.useRealTimers()
  })

  it('preserves the full public error DTO and cause on request failures', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    ready(socket)
    await connection
    const request = runtime.request('owner.status')
    const sent = socket.last()
    if (!sent.ok || sent.frame.type !== 'request') throw new Error('request not sent')
    const dto = {
      code: TelemetryErrorCode.ownerRemoteUnavailable,
      params: { retryAfterMs: 20 },
      retryable: true,
      message: 'A safe fallback.',
    }
    socket.receive({ type: 'response', requestId: sent.frame.requestId, error: dto })
    await expect(request).rejects.toMatchObject({
      code: dto.code,
      params: dto.params,
      retryable: true,
      publicError: dto,
    })
    const cause = new Error('original local failure')
    expect(new OwnerRequestError(dto, { cause }).cause).toBe(cause)
    runtime.close()
  })

  it('forwards owner notifications to lifecycle listeners', async () => {
    const socket = new FakeSocket()
    const runtime = createOwnerRuntime(() => socket)
    const connection = runtime.connect({ url: 'ws://owner.test' })
    socket.open()
    ready(socket)
    await connection
    const onNotification = vi.fn()
    const unsubscribe = runtime.subscribeNotification(onNotification)

    socket.receive({
      type: 'notification',
      method: 'remote.device.paired',
      params: { deviceId: 'device-1', clientToken: 'token-1' },
    })

    expect(onNotification).toHaveBeenCalledWith('remote.device.paired', {
      deviceId: 'device-1',
      clientToken: 'token-1',
    })
    unsubscribe()
  })
})
