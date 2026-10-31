import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFrame } from '@codex-web/protocol/relay'
import { createRelayOwnerSocket } from './relay-owner-socket'

class FakeWebSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('relay Owner socket admission', () => {
  it('sends only the reference-only enrollment attach for a new profile', () => {
    let socket: FakeWebSocket | undefined
    vi.stubGlobal(
      'WebSocket',
      class extends FakeWebSocket {
        constructor() {
          super()
          socket = this
        }
      },
    )
    const client = createRelayOwnerSocket('wss://relay.example.test/ws', {
      clientToken: '',
      publicKey: 'client-public-key',
      privateKey: {} as CryptoKey,
      enrollmentReference: 'enrollment-reference-1234',
    })

    ;(client as unknown as FakeWebSocket).open()
    const frame = parseFrame(socket!.sent[0]!)
    expect(frame).toMatchObject({
      type: 'relay.attach',
      role: 'client',
      admission: 'enrollment',
      reference: 'enrollment-reference-1234',
    })
    expect(frame).not.toHaveProperty('ownerCode')
    expect(frame).not.toHaveProperty('deviceId')
  })
})
