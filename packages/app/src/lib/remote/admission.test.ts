import { afterEach, describe, expect, it, vi } from 'vitest'
import { setPairedDevice } from './device-key-store'
import {
  authenticateRemoteDevice,
  completeProvisionalTwoFactor,
  openProvisionalSession,
  promoteProvisionalDevice,
  type AdmissionConnection,
} from './admission'

vi.mock('./device-key-store', () => ({ setPairedDevice: vi.fn() }))

function connectionWith(responses: unknown[]): AdmissionConnection & {
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn(async () => responses.shift())
  return { request, close: vi.fn() }
}

describe('remote admission', () => {
  afterEach(() => vi.clearAllMocks())

  it('opens a direct provisional session without sending credentials twice', async () => {
    const connection = connectionWith([
      { token: 'session-1', session: { user: { id: 'owner-1' } } },
    ])

    await expect(
      openProvisionalSession(connection, { email: 'owner@example.com', password: 'pw' }),
    ).resolves.toEqual({ authenticated: true, sessionToken: 'session-1', ownerId: 'owner-1' })
    expect(connection.request).toHaveBeenCalledTimes(1)
    expect(connection.request).toHaveBeenCalledWith('owner.session.open', {
      email: 'owner@example.com',
      password: 'pw',
    })
  })

  it.each([
    ['totp', 'remote.device.binding.verifyTotp'],
    ['recovery', 'remote.device.binding.verifyRecoveryCode'],
  ] as const)('completes a %s challenge once', async (kind, method) => {
    const connection = connectionWith([{ sessionToken: 'session-1', ownerId: 'owner-1' }])
    await expect(
      completeProvisionalTwoFactor(
        connection,
        { challengeId: 'challenge-1', expiresAt: '' },
        {
          kind,
          code: 'code-1',
        },
      ),
    ).resolves.toEqual({ sessionToken: 'session-1', ownerId: 'owner-1' })
    expect(connection.request).toHaveBeenCalledWith(method, {
      challengeId: 'challenge-1',
      code: 'code-1',
    })
  })

  it('fails closed when a two-factor response does not establish a session', async () => {
    const connection = connectionWith([{}])
    await expect(
      completeProvisionalTwoFactor(
        connection,
        { challengeId: 'challenge-1', expiresAt: '' },
        {
          kind: 'totp',
          code: 'code-1',
        },
      ),
    ).rejects.toThrow('Owner authentication did not complete.')
  })

  it('does not trust a device until authentication and trust challenge both succeed', async () => {
    const connection = connectionWith([
      { token: 'session-1', session: { user: { id: 'owner-1' } } },
      { challenge: 'challenge-1' },
      { deviceId: 'device-1', clientToken: 'client-1', ownerId: 'owner-1' },
    ])
    vi.mocked(setPairedDevice).mockResolvedValue(undefined)

    await expect(
      promoteProvisionalDevice({
        connection,
        credentials: { email: 'owner@example.com', password: 'pw' },
        factor: { kind: 'totp', code: '123456' },
        publicKey: 'public-key',
        trustEpoch: 3,
        nodeId: 'node-1',
        relayUrl: 'wss://relay.example.com',
      }),
    ).resolves.toMatchObject({
      deviceId: 'device-1',
      clientToken: 'client-1',
      trustEpoch: 3,
      sessionToken: 'session-1',
    })
    expect(connection.request).toHaveBeenNthCalledWith(2, 'remote.device.trust', {
      publicKey: 'public-key',
    })
    expect(connection.request).toHaveBeenNthCalledWith(3, 'remote.device.trust', {
      publicKey: 'public-key',
      challenge: 'challenge-1',
    })
    expect(setPairedDevice).toHaveBeenCalledWith({
      deviceId: 'device-1',
      pairedClientToken: 'client-1',
      trustEpoch: 3,
      nodeId: 'node-1',
      relayUrl: 'wss://relay.example.com',
    })
  })

  it('does not persist a paired token when trust does not complete', async () => {
    const connection = connectionWith([
      { token: 'session-1', session: { user: { id: 'owner-1' } } },
      { challenge: 'challenge-1' },
      { deviceId: 'device-1', ownerId: 'owner-1' },
    ])

    await expect(
      promoteProvisionalDevice({
        connection,
        credentials: { email: 'owner@example.com', password: 'pw' },
        factor: { kind: 'recovery', code: 'recovery-1' },
        publicKey: 'public-key',
        trustEpoch: 3,
      }),
    ).rejects.toThrow('Owner trust promotion returned an invalid result.')
    expect(setPairedDevice).not.toHaveBeenCalled()
  })
})
