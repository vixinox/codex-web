import { describe, expect, it, vi } from 'vitest'
import { authenticateWithRecoveryCode } from './admission'

describe('remote recovery admission', () => {
  it('reserves the code, registers a new credential, then finishes the recovery session', async () => {
    const credential = {
      id: 'credential-id',
      rawId: Uint8Array.from([1, 2, 3]).buffer,
      type: 'public-key',
      response: {
        attestationObject: Uint8Array.from([4, 5]).buffer,
        clientDataJSON: Uint8Array.from([6, 7]).buffer,
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({}),
    }
    class FakePublicKeyCredential {
      constructor() {
        Object.assign(this, credential)
      }
    }
    vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
    vi.stubGlobal('navigator', {
      credentials: { create: vi.fn().mockResolvedValue(new FakePublicKeyCredential()) },
    })
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        reservationId: 'reservation',
        registration: {
          challengeId: 'challenge',
          options: {
            challenge: 'AQID',
            user: { id: 'BAUG', name: 'Owner', displayName: 'Owner' },
          },
        },
      })
      .mockResolvedValueOnce({
        ownerId: 'owner',
        sessionToken: 'token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        deviceId: 'device',
        clientToken: 'paired',
        trustEpoch: 3,
        recoveryCodes: ['new-code'],
      })
    const result = await authenticateWithRecoveryCode({ request, close: vi.fn() }, 'one-time-code')
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'owner.recovery.login.reserve',
      'owner.recovery.login.finish',
    ])
    expect(request.mock.calls[0]?.[1]).toEqual({ code: 'one-time-code' })
    expect(result.ownerId).toBe('owner')
  })

  it('does not finish if the user cancels passkey registration', async () => {
    vi.stubGlobal('PublicKeyCredential', class {})
    vi.stubGlobal('navigator', { credentials: { create: vi.fn().mockResolvedValue(null) } })
    const request = vi.fn().mockResolvedValue({
      reservationId: 'reservation',
      registration: {
        challengeId: 'challenge',
        options: { challenge: 'AQID', user: { id: 'BAUG' } },
      },
    })
    await expect(authenticateWithRecoveryCode({ request, close: vi.fn() }, 'code')).rejects.toThrow(
      'Passkey registration was cancelled',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
})
