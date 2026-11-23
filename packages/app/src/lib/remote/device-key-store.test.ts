import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decryptConnectionProfileSession,
  decryptRemoteSession,
  encryptConnectionProfileSession,
  encryptRemoteSession,
  clearConnectionProfileSession,
  completeConnectionProfile,
  createConnectionProfileDraft,
  loadConnectionProfileSession,
  prepareConnectionProfileEnrollment,
  type ConnectionProfileRecord,
} from './device-key-store'

afterEach(() => vi.unstubAllGlobals())

function profileStorage() {
  const records = new Map<string, ConnectionProfileRecord>()
  const request = (result: unknown) => {
    const value = { result, onsuccess: () => {} }
    queueMicrotask(() => value.onsuccess())
    return value
  }
  vi.stubGlobal('indexedDB', {
    open: () =>
      request({
        close() {},
        transaction() {
          const tx = {
            oncomplete: () => {},
            objectStore: () => ({
              getAll: () => request([...records.values()]),
              get: (id: string) => request(records.get(id)),
              put(record: ConnectionProfileRecord) {
                records.set(record.id, record)
                queueMicrotask(() => tx.oncomplete())
              },
            }),
          }
          return tx
        },
      }),
  })
  return records
}

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
  it('reuses the browser identity and profile when a login link renews a logged-out session', async () => {
    const records = profileStorage()
    const relayUrl = 'wss://relay.example.test/ws'
    const profile = await prepareConnectionProfileEnrollment(relayUrl)
    const admission = {
      id: profile.id,
      nodeId: 'node',
      ownerId: 'owner',
      ownerPublicKey: 'owner-key',
      deviceId: 'device',
      pairedClientToken: 'paired-token',
      trustEpoch: 0,
      sessionToken: 'first-session',
      sessionExpiresAt: '2030-01-01T00:00:00.000Z',
    }
    await completeConnectionProfile(admission)
    await clearConnectionProfileSession(profile.id)
    const next = await prepareConnectionProfileEnrollment(relayUrl)
    expect(next.id).toBe(profile.id)
    expect(next.privateKey).toBe(profile.privateKey)
    expect(next.publicKey).toBe(profile.publicKey)
    expect(next.encryptedSession).toBeNull()
    await completeConnectionProfile({ ...admission, sessionToken: 'renewed-session' })
    expect(records.size).toBe(1)
    expect(await loadConnectionProfileSession(profile.id)).toMatchObject({
      token: 'renewed-session',
    })

    const saved = records.get(profile.id)
    for (const changed of [
      { ownerPublicKey: 'other-key' },
      { nodeId: 'other-node' },
      { trustEpoch: 1 },
      { ownerId: 'other-owner' },
    ])
      await expect(completeConnectionProfile({ ...admission, ...changed })).rejects.toThrow(
        'Owner identity',
      )
    expect(records.get(profile.id)).toBe(saved)
  })

  it('selects the most recently used paired profile for this Relay without deleting older records', async () => {
    const records = profileStorage()
    const relayUrl = 'wss://relay.example.test/ws'
    const profile = await createConnectionProfileDraft({ label: 'Saved', relayUrl })
    const paired = {
      ...profile,
      nodeId: 'node',
      ownerId: 'owner',
      ownerPublicKey: 'pin',
      deviceId: 'device',
      pairedClientToken: 'token',
      trustEpoch: 0,
    }
    records.set(profile.id, { ...paired, lastConnectedAt: '2026-11-01T00:00:00Z' })
    records.set('recent', { ...paired, id: 'recent', lastConnectedAt: '2026-11-22T00:00:00Z' })
    records.set('other-relay', {
      ...paired,
      id: 'other-relay',
      relayUrl: 'wss://other.test/ws',
      lastConnectedAt: '2026-11-23T00:00:00Z',
    })
    await createConnectionProfileDraft({ label: 'Unfinished', relayUrl })
    expect((await prepareConnectionProfileEnrollment(relayUrl)).id).toBe('recent')
    expect(records.size).toBe(4)
  })

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
