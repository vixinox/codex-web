import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFrame, parseFrame, RELAY_PROTOCOL_VERSION } from '@codex-web/protocol/relay'
import { createRelayOwnerSocket } from './relay-owner-socket'

class FakeWebSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.closed = true
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('relay login fingerprint gate', () => {
  it.each([undefined, 'unconfirmed-fingerprint'])(
    'closes before releasing queued login factors when the Owner fingerprint is %s',
    async (expectedOwnerFingerprint) => {
      const sockets: FakeWebSocket[] = []
      vi.stubGlobal(
        'WebSocket',
        class extends FakeWebSocket {
          constructor() {
            super()
            sockets.push(this)
          }
        },
      )
      const socket = createRelayOwnerSocket('wss://relay.example.test/ws', {
        nodeId: 'owner-node',
        trustEpoch: 3,
        clientToken: '',
        publicKey: 'client-public-key',
        privateKey: {} as CryptoKey,
        loginOwnerCode: '123456789',
        expectedOwnerFingerprint,
      }) as unknown as FakeWebSocket
      socket.send(JSON.stringify({ type: 'owner.login.factor', code: 'secret-factor' }))
      socket.open()
      socket.receive(
        encodeFrame({
          type: 'relay.client.connected',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: 'owner-node',
          connectionId: 'client-connection',
          admission: 'login',
          ownerCode: '123456789',
        }),
      )
      socket.receive(
        encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId: 'client-connection',
          payload: encodeFrame({
            type: 'handshake.ok',
            version: RELAY_PROTOCOL_VERSION,
            nodeId: 'owner-node',
            trustEpoch: 3,
            ownerPublicKey: 'owner-public-key',
            clientPublicKey: 'client-public-key',
          }),
        }),
      )

      await new Promise((resolve) => setTimeout(resolve, 0))
      const frames = sockets[0]!.sent.map((value) => parseFrame(value))
      expect(socket.closed).toBe(true)
      expect(frames.some((frame) => frame?.type === 'encrypted')).toBe(false)
      expect(sockets[0]!.sent.some((value) => value.includes('secret-factor'))).toBe(false)
    },
  )
})
