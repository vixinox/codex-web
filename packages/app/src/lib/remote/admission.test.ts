import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnerRequestError } from '@/lib/owner-ws/owner-runtime'
import { TelemetryErrorCode } from '@codex-web/telemetry/errors'
import { authenticateWithPasskey } from './admission'

afterEach(() => vi.unstubAllGlobals())

describe('authenticateWithPasskey', () => {
  it.each([true, false])(
    'requires Owner identity after successful Passkey verification: %s',
    async (hasOwnerId) => {
      class Credential {
        id = 'credential'
        rawId = new ArrayBuffer(1)
        type = 'public-key'
        response = {
          authenticatorData: new ArrayBuffer(1),
          clientDataJSON: new ArrayBuffer(1),
          signature: new ArrayBuffer(1),
          userHandle: null,
        }
        getClientExtensionResults() {
          return {}
        }
      }
      vi.stubGlobal('PublicKeyCredential', Credential)
      vi.stubGlobal('navigator', {
        credentials: { get: vi.fn().mockResolvedValue(new Credential()) },
      })
      const session = {
        token: 'test-session',
        expiresAt: '2099-01-01T00:00:00.000Z',
        ...(hasOwnerId ? { ownerId: 'owner-1' } : {}),
      }
      const request = vi
        .fn()
        .mockResolvedValueOnce({ challengeId: 'challenge', options: { challenge: 'Y2hhbGxlbmdl' } })
        .mockResolvedValueOnce(session)
      const result = authenticateWithPasskey({ request, close: vi.fn() })
      if (hasOwnerId) await expect(result).resolves.toEqual(session)
      else await expect(result).rejects.toMatchObject({ code: 'app.owner.protocol.invalid-frame' })
    },
  )

  it('directs users to configure a Passkey when none is registered', async () => {
    const request = vi.fn().mockRejectedValue(
      new OwnerRequestError({
        code: TelemetryErrorCode.ownerAuthPasskeyRequired,
        message: 'A Passkey is required.',
      }),
    )

    await expect(authenticateWithPasskey({ request, close: vi.fn() })).rejects.toThrow(
      'No Passkey is registered. Register one from a signed-in Owner device, then try again.',
    )
    expect(request).toHaveBeenCalledWith('owner.passkey.authentication.options')
  })

  it('directs remote users to configure a remote Passkey when none is registered', async () => {
    const request = vi.fn().mockRejectedValue(
      new OwnerRequestError({
        code: TelemetryErrorCode.ownerAuthPasskeyRequired,
        message: 'A Passkey is required.',
      }),
    )

    await expect(authenticateWithPasskey({ request, close: vi.fn() })).rejects.toThrow(
      'No Passkey is registered. Register one from a signed-in Owner device, then try again.',
    )
  })
})
