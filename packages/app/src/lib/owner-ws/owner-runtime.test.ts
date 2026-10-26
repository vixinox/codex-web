import { describe, expect, it, vi } from 'vitest'
import {
  encodeOwnerFrame,
  OWNER_PROTOCOL_VERSION,
  parseOwnerFrame,
} from '@codex-web/protocol/owner'
import { createOwnerRuntime, OwnerRequestError } from './owner-runtime'

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
    version: OWNER_PROTOCOL_VERSION,
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
    const rejected = expect(request).rejects.toBeInstanceOf(OwnerRequestError)
    await vi.advanceTimersByTimeAsync(11)
    await rejected
    expect(socket.sent.some((value) => value.includes('"type":"cancel"'))).toBe(true)
    vi.useRealTimers()
  })
})
