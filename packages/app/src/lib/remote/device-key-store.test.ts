import { describe, expect, it } from 'vitest'

import {
  decryptConnectionProfileSession,
  decryptRemoteSession,
  encryptConnectionProfileSession,
  encryptRemoteSession,
} from './device-key-store'

describe('encrypted remote Owner session', () => {
  it('encrypts the token with a non-exportable key and binds it to its target metadata', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const metadata = {
      relayUrl: 'wss://relay.example.test/ws',
      ownerCode: '123456789',
      nodeId: 'owner-node',
      deviceId: 'browser-device',
      ownerId: 'owner-user',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
    const encrypted = await encryptRemoteSession(key, 'owner-session-secret', metadata)

    expect(key.extractable).toBe(false)
    expect(encrypted.ciphertext).not.toContain('owner-session-secret')
    await expect(decryptRemoteSession(key, encrypted)).resolves.toBe('owner-session-secret')
    await expect(
      decryptRemoteSession(key, { ...encrypted, ownerCode: '987654321' }),
    ).rejects.toThrow()
    await expect(
      decryptRemoteSession(key, { ...encrypted, deviceId: 'other-device' }),
    ).rejects.toThrow()
    await expect(
      decryptRemoteSession(key, { ...encrypted, ownerId: 'other-owner' }),
    ).rejects.toThrow()
  })
})

describe('connection profile session', () => {
  it('encrypts credentials and binds them to the saved profile identity', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const metadata = {
      relayUrl: 'wss://relay.example.test/ws',
      nodeId: 'owner-node',
      ownerId: 'owner-user',
      ownerPublicKey: 'serialized-owner-public-key',
      deviceId: 'profile-device',
      trustEpoch: 4,
      expiresAt: '2030-01-01T00:00:00.000Z',
    }
    const encrypted = await encryptConnectionProfileSession(key, 'session-secret', metadata)

    expect(key.extractable).toBe(false)
    expect(encrypted.ciphertext).not.toContain('session-secret')
    await expect(decryptConnectionProfileSession(key, encrypted)).resolves.toBe('session-secret')
    await expect(
      decryptConnectionProfileSession(key, { ...encrypted, ownerPublicKey: 'replacement-key' }),
    ).rejects.toThrow()
    await expect(
      decryptConnectionProfileSession(key, { ...encrypted, trustEpoch: 5 }),
    ).rejects.toThrow()
  })
})
