import { describe, expect, it, vi } from 'vitest'
import {
  checkOwnerCodeAvailability,
  readKnownOwnerFingerprint,
  readOwnerCodePreference,
  readRecentOwnerTarget,
  saveRecentOwnerTarget,
  rememberOwnerFingerprint,
  saveRecentOwnerCode,
  unlockOwnerCodeEditing,
} from './owner-code-preference'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('owner code preference', () => {
  it('stores the recent code and a persistent editable preference', () => {
    const local = storage()
    saveRecentOwnerCode('123456789', local)
    expect(readOwnerCodePreference(local)).toEqual({
      ownerCode: '123456789',
      editable: false,
      target: null,
    })
    unlockOwnerCodeEditing(local)
    expect(readOwnerCodePreference(local)).toEqual({
      ownerCode: '123456789',
      editable: true,
      target: null,
    })
    expect(() => saveRecentOwnerCode('123', local)).toThrow('Owner code must contain 9 digits.')
  })

  it('stores and validates the successful Relay, code, and Owner target together', () => {
    const local = storage()
    const target = {
      relayUrl: 'wss://relay.example.test/ws',
      ownerCode: '123456789',
      nodeId: 'owner-1',
    }
    saveRecentOwnerTarget(target, local)
    expect(readRecentOwnerTarget(local)).toEqual(target)
    expect(readOwnerCodePreference(local)).toMatchObject({ ownerCode: target.ownerCode })
  })

  it('scopes remembered fingerprints to both Relay and Owner node', () => {
    const local = storage()
    rememberOwnerFingerprint('wss://relay-a.test/ws', 'owner-1', 'fingerprint-a', local)
    expect(readKnownOwnerFingerprint('wss://relay-a.test/ws', 'owner-1', local)).toBe(
      'fingerprint-a',
    )
    expect(readKnownOwnerFingerprint('wss://relay-b.test/ws', 'owner-1', local)).toBeNull()
  })

  it('distinguishes an online owner, an offline owner, and an unreachable relay', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://relay.example.test/owner-code/123456789')
      return Response.json({ online: true, nodeId: 'owner-1', trustEpoch: 0 })
    })
    await expect(
      checkOwnerCodeAvailability({
        relayUrl: 'wss://relay.example.test/ws',
        ownerCode: '123456789',
        fetcher,
      }),
    ).resolves.toEqual({ status: 'online', nodeId: 'owner-1', trustEpoch: 0 })
    fetcher.mockResolvedValueOnce(Response.json({ online: false }))
    await expect(
      checkOwnerCodeAvailability({
        relayUrl: 'https://relay.example.test',
        ownerCode: '123456789',
        fetcher,
      }),
    ).resolves.toEqual({ status: 'offline' })
    fetcher.mockRejectedValueOnce(new Error('network error'))
    await expect(
      checkOwnerCodeAvailability({
        relayUrl: 'https://relay.example.test',
        ownerCode: '123456789',
        fetcher,
      }),
    ).resolves.toEqual({ status: 'unreachable' })
  })
})
