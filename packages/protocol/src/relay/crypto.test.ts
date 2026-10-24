import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decryptPayload,
  deriveSessionKey,
  encryptPayload,
  generateKeyPair,
  serializeKeyPair,
  importPrivateKey,
  importPublicKey,
} from './crypto.js'

const ECDH_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const

type Exchange = {
  owner: Awaited<ReturnType<typeof generateKeyPair>>
  client: Awaited<ReturnType<typeof generateKeyPair>>
  ownerSerialized: Awaited<ReturnType<typeof serializeKeyPair>>
  clientSerialized: Awaited<ReturnType<typeof serializeKeyPair>>
  context: string
}

/**
 * Mirrors the context the Owner builds in `sessionKeyContext`. Both peers re-import the other's
 * serialized public key, so every test also covers the JWK round trip.
 */
async function exchange(context?: {
  nodeId?: string
  trustEpoch?: number
  ownerKey?: string
  clientKey?: string
}): Promise<Exchange> {
  const owner = await generateKeyPair()
  const client = await generateKeyPair()
  const ownerSerialized = await serializeKeyPair(owner)
  const clientSerialized = await serializeKeyPair(client)
  const nodeId = context?.nodeId ?? 'node-1'
  const trustEpoch = context?.trustEpoch ?? 2
  return {
    owner,
    client,
    ownerSerialized,
    clientSerialized,
    context: `codex-web-relay/v1/${nodeId}/${trustEpoch}/${
      context?.ownerKey ?? ownerSerialized.publicKey
    }/${context?.clientKey ?? clientSerialized.publicKey}`,
  }
}

/** The Owner half: its own private key against the client's serialized public key. */
async function ownerSessionKey(handle: Exchange, context = handle.context) {
  return deriveSessionKey(
    await importPrivateKey(handle.ownerSerialized.privateKey),
    await importPublicKey(handle.clientSerialized.publicKey),
    context,
  )
}

/** The client half: its own private key against the Owner's serialized public key. */
async function clientSessionKey(handle: Exchange, context = handle.context) {
  return deriveSessionKey(
    await importPrivateKey(handle.clientSerialized.privateKey),
    await importPublicKey(handle.ownerSerialized.publicKey),
    context,
  )
}

test('derives a shared channel and authenticates encrypted payloads', async () => {
  const handle = await exchange()
  const owner = await ownerSessionKey(handle)
  const client = await clientSessionKey(handle)
  const frame = await encryptPayload(owner, JSON.stringify({ ok: true }), 1)
  assert.equal(await decryptPayload(client, frame), JSON.stringify({ ok: true }))
  await assert.rejects(() => decryptPayload(client, { ...frame, sequence: 2 }))
  const wrongContextKey = await clientSessionKey(
    handle,
    handle.context.replace('/node-1/2/', '/node-1/3/'),
  )
  await assert.rejects(() => decryptPayload(wrongContextKey, frame))
})

test('only interoperates when both peers derive with the same context', async () => {
  const handle = await exchange()
  const owner = await ownerSessionKey(handle)
  const client = await clientSessionKey(handle)
  const confirmation = await encryptPayload(owner, JSON.stringify({ type: 'handshake.ok' }), 1)

  // Same context on both sides: the Owner's key confirmation decrypts. This is the property the
  // handshake relies on when `handshake.ok` is sent as the first encrypted record.
  assert.equal(await decryptPayload(client, confirmation), JSON.stringify({ type: 'handshake.ok' }))

  const other = await exchange()
  const mismatches: Record<string, string> = {
    nodeId: handle.context.replace('/node-1/', '/node-2/'),
    trustEpoch: handle.context.replace('/node-1/2/', '/node-1/3/'),
    ownerPublicKey: `codex-web-relay/v1/node-1/2/${other.ownerSerialized.publicKey}/${handle.clientSerialized.publicKey}`,
    clientPublicKey: `codex-web-relay/v1/node-1/2/${handle.ownerSerialized.publicKey}/${other.clientSerialized.publicKey}`,
  }

  for (const [field, context] of Object.entries(mismatches)) {
    assert.notEqual(context, handle.context, `${field}: the drifted context must differ`)
    await assert.rejects(
      () => decryptPayload(clientSessionKey(handle, context), confirmation),
      /operation|decrypt|tag|authenticat/iu,
      `a different ${field} must not decrypt the Owner key confirmation`,
    )
    // The reverse direction must not decrypt either: the binding is not one-sided.
    const record = await encryptPayload(client, JSON.stringify({ deviceId: 'd-1' }), 1)
    await assert.rejects(
      () => decryptPayload(ownerSessionKey(handle, context), record),
      /operation|decrypt|tag|authenticat/iu,
      `a different ${field} must not decrypt client records`,
    )
  }

  // Sanity: the matching keys really are interoperable in both directions.
  const record = await encryptPayload(client, JSON.stringify({ deviceId: 'd-1' }), 1)
  assert.equal(await decryptPayload(owner, record), JSON.stringify({ deviceId: 'd-1' }))
  assert.equal(await decryptPayload(client, confirmation), JSON.stringify({ type: 'handshake.ok' }))
})

test('binds the AAD to the sequence rather than only the IV', async () => {
  const handle = await exchange()
  const client = await clientSessionKey(handle)
  const plaintext = JSON.stringify({ ok: true })
  const frame = await encryptPayload(await ownerSessionKey(handle), plaintext, 4)
  assert.equal(await decryptPayload(client, frame), plaintext)

  // Replaying the same IV and ciphertext under another sequence changes nothing else about the
  // input, so a rejection here can only come from the additional authenticated data.
  for (const sequence of [3, 5, 40, -4, 4.5]) {
    const replay = { ...frame, sequence }
    assert.deepEqual(
      { iv: replay.iv, ciphertext: replay.ciphertext },
      { iv: frame.iv, ciphertext: frame.ciphertext },
    )
    await assert.rejects(
      () => decryptPayload(client, replay),
      /operation|decrypt|tag|authenticat/iu,
      `sequence ${sequence}`,
    )
  }

  // Flipping the last ciphertext byte fails the same tag check, and the original still decrypts.
  const tampered = Buffer.from(frame.ciphertext, 'base64url')
  tampered[tampered.length - 1] ^= 1
  await assert.rejects(() =>
    decryptPayload(client, { ...frame, ciphertext: tampered.toString('base64url') }),
  )
  assert.equal(await decryptPayload(client, frame), plaintext)
})

/**
 * Node's WebCrypto (verified on Node 24 / OpenSSL 3.5) validates the peer point at import time and
 * rejects the P-256 point at infinity with `DataError` for every encoding it accepts: `raw` `0x00`,
 * `raw` `04||0…0`, JWK with all-zero `x`/`y`, JWK with empty coordinates and SPKI with an infinity
 * point. A runtime that imports the key instead is equally valid, so both branches are covered:
 * whichever call refuses the key must reject, and when the import succeeds `deriveSessionKey` must
 * reject with `Invalid peer public key` because the shared secret is all zeros.
 */
test('rejects an all-zero shared secret from an invalid peer public key', async () => {
  const handle = await exchange()
  const privateKey = await importPrivateKey(handle.ownerSerialized.privateKey)
  const zero = Buffer.alloc(32).toString('base64url')
  const infinityEncodings: Array<{ label: string; peerPublicKey: CryptoKey | Promise<CryptoKey> }> =
    [
      {
        label: 'jwk all-zero coordinates',
        peerPublicKey: crypto.subtle.importKey(
          'jwk',
          { kty: 'EC', crv: 'P-256', x: zero, y: zero, ext: true, key_ops: [] },
          ECDH_ALGORITHM,
          true,
          [],
        ),
      },
      {
        label: 'raw point at infinity',
        peerPublicKey: crypto.subtle.importKey(
          'raw',
          new Uint8Array([0x00]),
          ECDH_ALGORITHM,
          true,
          [],
        ),
      },
      {
        label: 'raw uncompressed origin',
        peerPublicKey: crypto.subtle.importKey('raw', new Uint8Array(65), ECDH_ALGORITHM, true, []),
      },
    ]

  for (const { label, peerPublicKey: importAttempt } of infinityEncodings) {
    let peerPublicKey: CryptoKey
    try {
      peerPublicKey = await importAttempt
    } catch (error) {
      // Import-time rejection: the invalid point never reaches the derivation. This is the branch
      // Node takes for every encoding above.
      assert.ok(error instanceof Error, `${label}: importKey must throw an Error`)
      continue
    }
    await assert.rejects(
      () => deriveSessionKey(privateKey, peerPublicKey),
      /Invalid peer public key/u,
      `${label} imported but was not rejected by deriveSessionKey`,
    )
  }

  // Force the other branch: stand in for a runtime that accepts the invalid point and returns the
  // all-zero shared secret, then restore the real primitive.
  const subtle = crypto.subtle as unknown as { deriveBits: SubtleCrypto['deriveBits'] }
  const realDeriveBits = subtle.deriveBits.bind(crypto.subtle)
  const peerPublicKey = await importPublicKey(handle.clientSerialized.publicKey)
  subtle.deriveBits = async () => new Uint8Array(32).buffer
  try {
    await assert.rejects(
      () => deriveSessionKey(privateKey, peerPublicKey),
      /Invalid peer public key/u,
      'an all-zero shared secret must be rejected',
    )
  } finally {
    subtle.deriveBits = realDeriveBits
  }

  // The guard must not reject genuine exchanges: the restored primitive derives a usable key.
  const owner = await ownerSessionKey(handle)
  const client = await clientSessionKey(handle)
  const frame = await encryptPayload(owner, JSON.stringify({ ok: true }), 1)
  assert.equal(await decryptPayload(client, frame), JSON.stringify({ ok: true }))
})
