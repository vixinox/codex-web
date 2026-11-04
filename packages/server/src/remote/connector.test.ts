import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  decryptPayload,
  deriveSessionKey,
  encryptPayload,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  serializeKeyPair,
  type SerializedKeyPair,
  type SessionKey,
} from '@codex-web/protocol/relay/crypto'
import {
  encodeFrame as encodeRelayFrame,
  isHandshakeOkFrame,
  parseFrame as parseRelayFrame,
  RELAY_PROTOCOL_VERSION,
  type ConnectionCloseFrame,
  type RelayAttachFrame,
  type RelayFrame,
} from '@codex-web/protocol/relay'
import { encodeOwnerFrame, parseOwnerFrame, type OwnerFrame } from '@codex-web/protocol/owner'

import type { ServerConfig } from '../config.js'
import type { OwnerMethodDefinition } from '../owner/session-runtime.js'
import { OwnerConnector } from './connector.js'
import { RemoteTrustStore } from './trust-store.js'

const RELAY_URL = 'wss://relay.example.test/ws'
const OWNER_TOKEN = 'relay-owner-token-that-is-at-least-32-characters'
const SESSION_TOKEN = 'session-token'

class FakeSocket {
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((data: string | ArrayBuffer | Uint8Array | Buffer) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  closeCode?: number
  closeReason?: string
  pingCount = 0
  pongListener?: () => void
  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    if (this.closed) return
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.onclose?.()
  }
  ping() {
    this.pingCount += 1
    this.pongListener?.()
  }
  on(event: 'pong', listener: () => void) {
    if (event === 'pong') this.pongListener = listener
  }
  deliver(frame: string) {
    this.onmessage?.(frame)
  }
}

/**
 * Yields to the connector's serialized inbound queue: `deliver` only enqueues work behind earlier
 * messages, so a state change is observable after the pending queue has run.
 */
function flushInbound() {
  const { promise, resolve } = Promise.withResolvers<void>()
  setImmediate(resolve)
  return promise
}

/** Sequence numbers of the encrypted records the owner has sent on `connectionId`. */
function encryptedSequences(socket: FakeSocket, connectionId: string) {
  return sentPayloads(socket, connectionId)
    .filter((frame) => frame.type === 'encrypted')
    .map((frame) => (frame as Extract<RelayFrame, { type: 'encrypted' }>).sequence)
}

async function waitFor(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`)
    await flushInbound()
  }
}

function forward(connectionId: string, payload: string) {
  return encodeRelayFrame({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId,
    payload,
  })
}

/** Payloads the owner forwarded to `connectionId`, newest last. */
function sentPayloads(socket: FakeSocket, connectionId: string) {
  return socket.sent
    .map((entry) => parseRelayFrame(entry))
    .filter(
      (frame): frame is Extract<RelayFrame, { type: 'relay.forward' }> =>
        frame?.type === 'relay.forward' && frame.connectionId === connectionId,
    )
    .map((frame) => parseRelayFrame(frame.payload))
    .filter((frame): frame is RelayFrame => frame !== null)
}

async function decryptOwnerFrames(clientKey: SessionKey, payloads: RelayFrame[]) {
  const frames: { owner: OwnerFrame | null; relay: RelayFrame | null }[] = []
  for (const frame of payloads) {
    if (frame.type !== 'encrypted') continue
    const text = await decryptPayload(clientKey, frame)
    const owner = parseOwnerFrame(text)
    frames.push({
      owner: owner.ok ? owner.frame : null,
      relay: owner.ok ? null : parseRelayFrame(text),
    })
  }
  return frames
}

function methodRegistry(connector: OwnerConnector, submittedFactors: string[]) {
  const methods: [string, OwnerMethodDefinition][] = [
    ['owner.status', { access: 'authenticated', handle: () => ({ status: 'ready' }) }],
    [
      'owner.transport.binding',
      {
        access: 'authenticated',
        handle: (_params, context) => ({
          kind: context.transport.kind,
          clientPublicKey: context.transport.clientPublicKey,
        }),
      },
    ],
    [
      'owner.enrollment.redeem',
      {
        access: 'public',
        handle: async (_params, context) => {
          if (context.transport.kind !== 'relay' || context.transport.enrollmentCandidate !== true)
            throw new Error('Enrollment candidate required')
          const publicKey = context.transport.clientPublicKey
          if (!publicKey || !context.transport.promote) throw new Error('Candidate key missing')
          const { deviceId } = await connector.trust.trustPeerWithStatus(publicKey)
          const clientToken = await connector.createPairedClientToken(deviceId)
          await context.authenticate({
            ownerId: 'owner-1',
            sessionId: 'session-1',
            sessionToken: SESSION_TOKEN,
          })
          context.transport.promote(deviceId, clientToken)
          return { ownerId: 'owner-1', deviceId, clientToken }
        },
      },
    ],
    [
      'owner.passkey.authentication.verify',
      {
        access: 'public',
        handle: async (_params, context) => {
          const publicKey = context.transport.clientPublicKey
          if (!publicKey || !context.transport.promote) throw new Error('Candidate key missing')
          const { deviceId } = await connector.trust.trustPeerWithStatus(publicKey)
          const clientToken = await connector.createPairedClientToken(deviceId)
          await context.authenticate({
            ownerId: 'owner-1',
            sessionId: 'session-1',
            sessionToken: SESSION_TOKEN,
          })
          context.transport.promote(deviceId, clientToken)
          return { ownerId: 'owner-1', sessionToken: SESSION_TOKEN, deviceId, clientToken }
        },
      },
    ],
    ['owner.workspace.read', { access: 'authenticated', handle: () => ({ secret: 'business' }) }],
  ]
  return new Map(methods)
}

async function deriveClientKey(
  identity: { nodeId: string; trustEpoch: number; ownerPublicKey: string },
  clientKeys: SerializedKeyPair,
) {
  return deriveSessionKey(
    await importPrivateKey(clientKeys.privateKey),
    await importPublicKey(identity.ownerPublicKey),
    `codex-web-relay/v1/${identity.nodeId}/${identity.trustEpoch}/${identity.ownerPublicKey}/${clientKeys.publicKey}`,
  )
}

type Harness = {
  /** Every socket the connector dialed, oldest first; a reconnect appends one. */
  sockets: FakeSocket[]
  connector: OwnerConnector
  socket: FakeSocket
  attach: RelayAttachFrame
  nodeId: string
  clientKeys: SerializedKeyPair
  clientKey: SessionKey
  deviceId: string
  trustEpoch: number
  submittedFactors: string[]
}

/** Brings a registered device through relay attach and its first E2EE handshake. */
async function createHarness(
  connector: OwnerConnector,
  sockets: FakeSocket[],
  enrollmentCandidate = false,
  submittedFactors: string[] = [],
): Promise<Harness> {
  connector.configureRemoteSessions(methodRegistry(connector, submittedFactors), async (token) =>
    token === SESSION_TOKEN ? { ownerId: 'owner-1', sessionId: 'session-1' } : null,
  )
  await connector.start()
  const socket = sockets.at(-1)
  if (!socket) throw new Error('The connector did not dial the relay.')

  socket.onopen?.()
  await waitFor(() => socket.sent.length === 1, 'the relay attach frame')
  const attach = parseRelayFrame(socket.sent[0]!)
  if (attach?.type !== 'relay.attach' || attach.role !== 'owner')
    throw new Error('Expected relay owner attach.')
  socket.deliver(
    encodeRelayFrame({
      type: 'relay.ready',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: attach.nodeId,
      role: 'owner',
      connectionId: attach.connectionId,
    }),
  )
  await waitFor(() => connector.isConnected(), 'the relay to become ready')

  const clientKeys = await serializeKeyPair(await generateKeyPair())
  const deviceId = enrollmentCandidate
    ? 'enrollment'
    : (await connector.trust.trustPeerWithStatus(clientKeys.publicKey)).deviceId

  const identity = await connector.trust.identity()
  const clientKey = await deriveClientKey(identity, clientKeys)
  socket.deliver(
    encodeRelayFrame({
      type: 'relay.client.connected',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: attach.nodeId,
      connectionId: 'client-connection',
      ...(enrollmentCandidate
        ? { admission: 'enrollment' as const, reference: 'ref-123456789' }
        : { deviceId }),
    }),
  )
  socket.deliver(
    forward(
      'client-connection',
      encodeRelayFrame({
        type: 'handshake',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: identity.nodeId,
        clientPublicKey: clientKeys.publicKey,
        trustEpoch: identity.trustEpoch,
      }),
    ),
  )
  await waitFor(
    () => sentPayloads(socket, 'client-connection').some((frame) => frame.type === 'encrypted'),
    'the encrypted handshake confirmation',
  )

  return {
    sockets,
    connector,
    socket,
    attach,
    nodeId: identity.nodeId,
    clientKeys,
    clientKey,
    deviceId,
    trustEpoch: identity.trustEpoch,
    submittedFactors,
  }
}

/** Encrypts an owner frame on the client side and hands it to the connector as a relay forward. */
async function sendClientFrame(
  harness: Harness,
  frame: OwnerFrame,
  sequence: number,
  connectionId = 'client-connection',
) {
  harness.socket.deliver(
    forward(
      connectionId,
      encodeRelayFrame(await encryptPayload(harness.clientKey, encodeOwnerFrame(frame), sequence)),
    ),
  )
}

function helloFrame(sessionToken = SESSION_TOKEN): OwnerFrame {
  return {
    type: 'hello',

    clientId: 'remote-client',
    capabilities: ['owner'],
    sessionToken,
  }
}

/**
 * Runs `fn` against a connector that owns one fake relay socket. The socket and the temp data dir
 * are always released: `stop()` clears the heartbeat/ready timers and closes the socket, which is
 * what lets the trust store's write chain settle before the directory is removed.
 */
async function withHarness(fn: (harness: Harness) => Promise<void>, enrollmentCandidate = false) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-web-connector-'))
  // Every dial gets its own socket, like the real relay client: a closed socket is never reused.
  const sockets: FakeSocket[] = []
  const connector = new OwnerConnector(
    {
      remoteRelayUrl: RELAY_URL,
      remoteRelayOwnerToken: OWNER_TOKEN,
      dataRoot,
    } as ServerConfig,
    new RemoteTrustStore(dataRoot),
    () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as never
    },
    { intervalMs: 10, staleTimeoutMs: 100 },
  )
  try {
    const submittedFactors: string[] = []
    await fn(await createHarness(connector, sockets, enrollmentCandidate, submittedFactors))
  } finally {
    await connector.stop()
    await rm(dataRoot, { recursive: true, force: true })
  }
}

test('keeps the relay owner connection alive while pong responses arrive', async (t) => {
  await withHarness(async ({ socket }) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.ok(socket.pingCount >= 4)
    assert.equal(socket.closeReason, undefined)
  })
})

test('admits a registered device, confirms the session key, and carries Owner frames both ways', async () => {
  await withHarness(async (harness) => {
    const { socket, connector, clientKeys, clientKey } = harness

    const confirmation = (
      await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    )[0]?.relay
    if (!isHandshakeOkFrame(confirmation ?? null))
      throw new Error('Expected an encrypted handshake.ok.')
    assert.equal(confirmation.clientPublicKey, clientKeys.publicKey)
    assert.equal(confirmation.nodeId, harness.nodeId)
    assert.equal(confirmation.trustEpoch, harness.trustEpoch)
    assert.equal(confirmation.ownerPublicKey, (await connector.trust.identity()).ownerPublicKey)

    await sendClientFrame(harness, helloFrame(), 1)
    // `handshake.ok` is record 1, so the admission reply is record 2.
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 2,
      'the hello to be admitted',
    )
    const ready = (
      await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    ).find((frame) => frame.owner?.type === 'ready')
    if (ready?.owner?.type !== 'ready') throw new Error('Expected an owner ready frame.')
    assert.equal(ready.owner.authenticated, true)

    await sendClientFrame(harness, { type: 'request', requestId: 'r1', method: 'owner.status' }, 2)
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 3,
      'the response to owner.status',
    )
    const response = (
      await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    ).find((frame) => frame.owner?.type === 'response')
    if (response?.owner?.type !== 'response') throw new Error('Expected an owner response frame.')
    assert.deepEqual(response.owner.result, { status: 'ready' })

    await sendClientFrame(
      harness,
      { type: 'request', requestId: 'binding-1', method: 'owner.transport.binding' },
      3,
    )
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 4,
      'the transport binding response',
    )
    const bindingResponse = (
      await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    ).find((frame) => frame.owner?.type === 'response' && frame.owner.requestId === 'binding-1')
    if (bindingResponse?.owner?.type !== 'response')
      throw new Error('Expected a transport binding response.')
    assert.deepEqual(bindingResponse.owner.result, {
      kind: 'relay',
      clientPublicKey: clientKeys.publicKey,
    })

    const devices = await connector.listDevices()
    assert.equal(devices.length, 1)
    assert.equal(devices[0]!.id, harness.deviceId)
    assert.equal(devices[0]!.lastSeenAt !== null, true)

    assert.equal(await connector.revokeDevice(devices[0]!.id), true)
    assert.deepEqual(await connector.listDevices(), [])
    const closeFrame = (
      await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    ).at(-1)?.relay
    if (closeFrame?.type !== 'connection.close')
      throw new Error('Expected an encrypted connection.close.')
    assert.equal(closeFrame.code, 'device_revoked')
  })
})

test('enrollment promotes the E2EE candidate after the redeem response', async () => {
  await withHarness(async (harness) => {
    const { socket, clientKey, connector, clientKeys } = harness

    await sendClientFrame(harness, helloFrame(), 1)
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 2,
      'the enrollment candidate to receive ready',
    )
    await sendClientFrame(
      harness,
      {
        type: 'request',
        requestId: 'redeem-1',
        method: 'owner.enrollment.redeem',
      },
      2,
    )
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 4,
      'the enrollment response and paired close notification',
    )

    const frames = await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    const responseIndex = frames.findIndex(
      (frame) => frame.owner?.type === 'response' && frame.owner.requestId === 'redeem-1',
    )
    const closeIndex = frames.findIndex((frame) => frame.relay?.type === 'connection.close')
    assert.ok(responseIndex >= 0)
    assert.ok(closeIndex > responseIndex)
    const [device] = await connector.listDevices()
    assert.ok(device)
    assert.equal(await connector.trust.deviceId(clientKeys.publicKey), device.id)
  }, true)
})

test('rejects a second handshake on an established connection', async () => {
  await withHarness(async (harness) => {
    const { socket, connector, clientKey } = harness

    // The duplicate handshake is the next frame the connector processes, so everything the owner
    // sends from here on belongs to the teardown.
    await Promise.resolve()
    const before = socket.sent.length
    socket.deliver(
      forward(
        'client-connection',
        encodeRelayFrame({
          type: 'handshake',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: harness.nodeId,
          clientPublicKey: harness.clientKeys.publicKey,
          trustEpoch: harness.trustEpoch,
        }),
      ),
    )
    await waitFor(
      () => socket.sent.length > before,
      'the owner to close the routing slot of the duplicated connection',
    )
    const frames = socket.sent.slice(before).map((entry) => parseRelayFrame(entry))
    assert.deepEqual(
      frames.map((frame) => frame?.type),
      ['relay.forward'],
    )
    const closeFrame = parseRelayFrame((frames[0] as { payload: string }).payload)
    if (closeFrame?.type !== 'connection.close')
      throw new Error('Expected the owner to close the routing slot.')
    assert.ok(isCloseWithCode(closeFrame, 'duplicate_handshake'))

    // The slot is gone, so a late encrypted frame is dropped instead of being replayed into a new
    // runtime: no response and no fresh runtime traffic may appear.
    const afterTeardown = socket.sent.length
    await sendClientFrame(harness, helloFrame(), 1)
    await flushInbound()
    await flushInbound()
    assert.equal(socket.sent.length, afterTeardown)
    const lateReplies = await decryptOwnerFrames(
      clientKey,
      sentPayloads(socket, 'client-connection'),
    )
    assert.equal(
      lateReplies.some((frame) => frame.owner?.type === 'ready'),
      false,
    )
    assert.deepEqual(
      (await connector.listDevices()).map((device) => device.id),
      [harness.deviceId],
    )
  })
})

test('requires the relay device binding before admitting a handshake', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-web-connector-'))
  let connector: OwnerConnector | undefined
  try {
    const socket = new FakeSocket()
    connector = new OwnerConnector(
      {
        remoteRelayUrl: RELAY_URL,
        remoteRelayOwnerToken: OWNER_TOKEN,
        dataRoot,
      } as ServerConfig,
      new RemoteTrustStore(dataRoot),
      () => socket as never,
    )
    connector.configureRemoteSessions(methodRegistry(), async () => ({
      ownerId: 'owner-1',
      sessionId: 'session-1',
    }))
    await connector.start()
    socket.onopen?.()
    await waitFor(() => socket.sent.length === 1, 'the relay attach frame')
    const attach = parseRelayFrame(socket.sent[0]!)
    if (attach?.type !== 'relay.attach') throw new Error('Expected relay attach.')
    socket.deliver(
      encodeRelayFrame({
        type: 'relay.ready',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: attach.nodeId,
        role: 'owner',
        connectionId: attach.connectionId,
      }),
    )
    await waitFor(() => connector!.isConnected(), 'the relay to become ready')
    socket.deliver(
      encodeRelayFrame({
        type: 'relay.client.connected',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: attach.nodeId,
        connectionId: 'anonymous',
      }),
    )
    // Without a device binding the connector refuses the connection instead of guessing identity,
    // and tears down the relay link so no unidentified routing slot stays open.
    assert.equal(connector.isConnected(), true)
    await waitFor(() => socket.closed, 'the relay link to be torn down')
    assert.equal(connector.isConnected(), false)
  } finally {
    await connector?.stop()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('drops an admitted remote frame once the relay reports the client disconnected', async () => {
  await withHarness(async (harness) => {
    const { socket, clientKey } = harness

    // `owner.status` only answers on an authenticated session, so a response proves the frame
    // reached a live runtime with the paired device identity injected.
    await sendClientFrame(harness, helloFrame(), 1)
    await sendClientFrame(
      harness,
      { type: 'request', requestId: 'before-1', method: 'owner.status' },
      2,
    )
    // `handshake.ok` + `ready` + the response.
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 3,
      'the pre-disconnect response',
    )
    const admitted = await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    const response = admitted.find((frame) => frame.owner?.type === 'response')
    if (response?.owner?.type !== 'response') throw new Error('Expected an owner response frame.')
    assert.equal(response.owner.requestId, 'before-1')

    socket.deliver(
      encodeRelayFrame({
        type: 'relay.client.disconnected',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: harness.attach.nodeId,
        connectionId: 'client-connection',
      }),
    )
    await waitFor(
      () =>
        socket.sent.some((entry) => forwardsClose(entry, 'client-connection', 'peer_disconnected')),
      'the routing slot of the departed client to be closed',
    )

    // The transport teardown must retire the runtime, so a second encrypted frame with the same
    // session key and a fresh sequence is dropped instead of being executed.
    const afterTeardown = socket.sent.length
    await sendClientFrame(
      harness,
      { type: 'request', requestId: 'after-1', method: 'owner.status' },
      3,
    )
    // Let the connector drain everything queued behind the disconnected client, then assert that
    // the late frame produced nothing.
    await flushInbound()
    await flushInbound()
    assert.equal(socket.sent.length, afterTeardown)
    // Nothing emitted during the drain may answer the late request either.
    const late = await decryptOwnerFrames(
      clientKey,
      socket.sent
        .slice(afterTeardown)
        .map((entry) => parseRelayFrame(entry))
        .filter((frame): frame is RelayFrame => frame !== null),
    )
    assert.deepEqual(late, [])
  })
})

test('rejects a handshake from a rotated trust epoch as an unauthorized client', async () => {
  await withHarness(async (harness) => {
    const { socket, clientKeys, trustEpoch } = harness
    const staleEpoch = trustEpoch + 1
    // A frame bound to the superseded epoch cannot be verified under any key: the connector must
    // reject the handshake outright, before any encrypted reply exists.
    const staleKey = await deriveClientKey(
      { ...(await harness.connector.trust.identity()), trustEpoch: staleEpoch },
      clientKeys,
    )
    socket.deliver(
      encodeRelayFrame({
        type: 'relay.client.connected',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: harness.attach.nodeId,
        connectionId: 'stale-epoch',
        deviceId: harness.deviceId,
      }),
    )
    socket.deliver(
      forward(
        'stale-epoch',
        encodeRelayFrame({
          type: 'handshake',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: harness.nodeId,
          clientPublicKey: clientKeys.publicKey,
          trustEpoch: staleEpoch,
        }),
      ),
    )
    await waitFor(
      () => socket.sent.some((entry) => forwardsClose(entry, 'stale-epoch', 'unauthorized_client')),
      'the stale-epoch handshake to be rejected',
    )
    assert.deepEqual(sentPayloads(socket, 'stale-epoch'), [
      { type: 'connection.close', version: RELAY_PROTOCOL_VERSION, code: 'unauthorized_client' },
    ])
    assert.equal(
      sentPayloads(socket, 'stale-epoch').some((frame) => frame.type === 'encrypted'),
      false,
    )
    assert.equal(
      (await decryptOwnerFrames(staleKey, sentPayloads(socket, 'stale-epoch'))).length,
      0,
    )
    // The established connection of the real device keeps working.
    await sendClientFrame(harness, helloFrame(), 1)
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 2,
      'the established connection to stay usable',
    )
  })
})

test('resetRemoteTrust closes live connections and rotates the trust epoch', async () => {
  await withHarness(async (harness) => {
    const { socket, connector, clientKey } = harness
    await sendClientFrame(harness, helloFrame(), 1)
    await waitFor(
      () => encryptedSequences(socket, 'client-connection').length === 2,
      'the client to be admitted before the reset',
    )
    const before = await connector.trust.identity()
    const reset = await connector.resetRemoteTrust()
    assert.equal(reset.trustEpoch, before.trustEpoch + 1)
    assert.equal(reset.nodeId, before.nodeId)
    assert.notEqual(reset.ownerPublicKey, before.ownerPublicKey)
    const rotated = await connector.trust.identity()
    assert.equal(rotated.trustEpoch, before.trustEpoch + 1)
    assert.equal(rotated.ownerPublicKey, reset.ownerPublicKey)
    assert.deepEqual(await connector.listDevices(), [])

    const closeFrame = (
      await decryptOwnerFrames(clientKey, sentPayloads(socket, 'client-connection'))
    ).at(-1)?.relay
    if (closeFrame?.type !== 'connection.close')
      throw new Error('Expected an encrypted connection.close from the reset.')
    assert.equal(closeFrame.code, 'trust_reset')

    // Live connections are gone: a request under the old session key is never executed again.
    const afterReset = socket.sent.length
    await sendClientFrame(
      harness,
      { type: 'request', requestId: 'post-reset', method: 'owner.status' },
      2,
    )
    await flushInbound()
    await flushInbound()
    assert.equal(socket.sent.length, afterReset)
    // The relay link is recycled and re-attached under the rotated epoch, so the owner becomes
    // reachable again without a restart.
    await waitFor(() => socket.closed, 'the relay link to be closed by the reset')
    assert.equal(socket.closeCode, 1000)
    assert.equal(socket.closeReason, 'trust_reset')
    await waitFor(
      () => harness.sockets.length > 1,
      'the connector to dial the relay again after the reset',
    )
    const redial = harness.sockets.at(-1)!
    redial.onopen?.()
    await waitFor(() => redial.sent.length === 1, 'the re-attach frame on the new dial')
    const reattach = parseRelayFrame(redial.sent[0]!)
    if (reattach?.type !== 'relay.attach') throw new Error('Expected a relay attach frame.')
    assert.equal(reattach.trustEpoch, before.trustEpoch + 1)
    assert.equal(reattach.nodeId, harness.nodeId)
  })
})

/** True when the relay frame is a plaintext `connection.close` carrying `code`. */
function isCloseWithCode(frame: RelayFrame | null, code: string): frame is ConnectionCloseFrame {
  return frame?.type === 'connection.close' && frame.code === code
}

/** True when the raw relay frame forwards a plaintext `connection.close{code}` into `connectionId`. */
function forwardsClose(entry: string, connectionId: string, code: string) {
  const outer = parseRelayFrame(entry)
  if (outer?.type !== 'relay.forward' || outer.connectionId !== connectionId) return false
  return isCloseWithCode(parseRelayFrame(outer.payload), code)
}
