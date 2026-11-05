import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFrame, parseFrame, RELAY_PROTOCOL_VERSION } from '@codex-web/protocol/relay'
import {
  deriveSessionKey,
  encryptPayload,
  generatePersistentDeviceKeyPair,
  importPublicKey,
  serializePublicKey,
} from './relay-crypto'
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

function waitFor(predicate: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > 1000) return reject(new Error('Timed out waiting for socket.'))
      setTimeout(poll, 1)
    }
    poll()
  })
}

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

  it('passes encrypted connection close frames to the Owner runtime as close frames', async () => {
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
    const clientKeys = await generatePersistentDeviceKeyPair()
    const ownerKeys = await generatePersistentDeviceKeyPair()
    const clientPublicKey = await serializePublicKey(clientKeys.publicKey)
    const ownerPublicKey = await serializePublicKey(ownerKeys.publicKey)
    const relaySocket = createRelayOwnerSocket('wss://relay.example.test/ws', {
      clientToken: '',
      publicKey: clientPublicKey,
      privateKey: clientKeys.privateKey,
      enrollmentReference: 'enrollment-reference-1234',
    }) as unknown as FakeWebSocket
    const received: string[] = []
    relaySocket.addEventListener('message', (event) => received.push((event as MessageEvent).data))

    relaySocket.open()
    const attachment = parseFrame(relaySocket.sent[0]!)
    expect(attachment?.type).toBe('relay.attach')
    if (attachment?.type !== 'relay.attach') throw new Error('Expected relay attach.')
    relaySocket.dispatchEvent(
      new MessageEvent('message', {
        data: encodeFrame({
          type: 'relay.ready',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: 'node-1',
          role: 'client',
          connectionId: attachment.connectionId,
          trustEpoch: 1,
          ownerPublicKey,
        }),
      }),
    )
    expect(received).toEqual([])
    await waitFor(() => relaySocket.sent.length > 1)

    const key = await deriveSessionKey(
      ownerKeys.privateKey,
      await importPublicKey(clientPublicKey),
      `codex-web-relay/v1/node-1/1/${ownerPublicKey}/${clientPublicKey}`,
    )
    const handshakeConfirmation = await encryptPayload(
      key,
      encodeFrame({
        type: 'handshake.ok',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: 'node-1',
        trustEpoch: 1,
        ownerPublicKey,
        clientPublicKey,
      }),
      1,
    )
    relaySocket.dispatchEvent(
      new MessageEvent('message', {
        data: encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId: attachment.connectionId,
          payload: encodeFrame(handshakeConfirmation),
        }),
      }),
    )

    const closePayload = await encryptPayload(
      key,
      encodeFrame({
        type: 'connection.close',
        version: RELAY_PROTOCOL_VERSION,
        code: 'unauthorized_client',
        message: 'Remote admission is not valid.',
      }),
      2,
    )
    relaySocket.dispatchEvent(
      new MessageEvent('message', {
        data: encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId: attachment.connectionId,
          payload: encodeFrame(closePayload),
        }),
      }),
    )

    await waitFor(() => received.some((value) => value.includes('unauthorized_client')))
    expect(JSON.parse(received.at(-1)!)).toEqual({
      type: 'close',
      code: 'unauthorized_client',
      message: 'Remote admission is not valid.',
    })
  })
})
