import { describe, expect, it, vi } from 'vitest'
import { encodeOwnerFrame, OWNER_PROTOCOL_VERSION } from '@codex-web/protocol/owner'
import { createOwnerRuntime } from './owner-runtime'
import { createOwnerRuntimeController } from './runtime-controller'

class FakeSocket {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  send = vi.fn()
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
}

function ready(socket: FakeSocket) {
  socket.receive({
    type: 'ready',
    version: OWNER_PROTOCOL_VERSION,
    connectionId: 'controller-connection',
    authenticated: true,
    capabilities: ['owner'],
  })
}

describe('Owner runtime controller', () => {
  it('projects connected state and supports switching targets', async () => {
    const sockets: FakeSocket[] = []
    const controller = createOwnerRuntimeController(
      createOwnerRuntime(() => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      }),
    )
    const first = controller.connect({ url: 'ws://one', sessionToken: 'token-1' })
    sockets[0].open()
    ready(sockets[0])
    await first
    expect(controller.state).toMatchObject({
      transport: 'connected',
      authentication: 'authenticated',
      runtime: 'ready',
    })

    const second = controller.switchTarget({ url: 'ws://two', sessionToken: 'token-2' })
    expect(sockets[0].close).toHaveBeenCalled()
    sockets[1].open()
    ready(sockets[1])
    await second
    expect(controller.state.transport).toBe('connected')
  })

  it('retries a dropped connection with bounded backoff', async () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const controller = createOwnerRuntimeController(
      createOwnerRuntime(() => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      }),
      { reconnectDelayMs: 10, maxReconnectAttempts: 2 },
    )
    const connected = controller.connect({ url: 'ws://owner', sessionToken: 'token' })
    sockets[0].open()
    ready(sockets[0])
    await connected
    sockets[0].onclose?.({} as CloseEvent)
    expect(controller.state.transport).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(10)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    ready(sockets[1])
    await vi.runOnlyPendingTimersAsync()
    expect(controller.state.transport).toBe('connected')
    controller.close()
    vi.useRealTimers()
  })
})
