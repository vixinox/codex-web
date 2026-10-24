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

test('derives a shared channel and authenticates encrypted payloads', async () => {
  const owner = await generateKeyPair()
  const client = await generateKeyPair()
  const ownerSerialized = await serializeKeyPair(owner)
  const clientSerialized = await serializeKeyPair(client)
  const ownerKey = await deriveSessionKey(
    await importPrivateKey(ownerSerialized.privateKey),
    await importPublicKey(clientSerialized.publicKey),
  )
  const clientKey = await deriveSessionKey(
    await importPrivateKey(clientSerialized.privateKey),
    await importPublicKey(ownerSerialized.publicKey),
  )
  const frame = await encryptPayload(ownerKey, JSON.stringify({ ok: true }), 1)
  assert.equal(await decryptPayload(clientKey, frame), JSON.stringify({ ok: true }))
  await assert.rejects(() => decryptPayload(clientKey, { ...frame, sequence: 2 }))
})
