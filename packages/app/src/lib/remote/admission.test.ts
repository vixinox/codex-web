import { describe, expect, it, vi } from 'vitest'
import { OwnerRequestError } from '@/lib/owner-ws/owner-runtime'
import { authenticateWithPasskey } from './admission'

describe('authenticateWithPasskey', () => {
  it('directs local users to register a Passkey when none is configured', async () => {
    const request = vi.fn().mockRejectedValue(
      new OwnerRequestError({
        code: 'PASSKEY_REQUIRED',
        message: 'A Passkey is required.',
      }),
    )

    await expect(authenticateWithPasskey({ request, close: vi.fn() }, 'local')).rejects.toThrow(
      'No local Passkey is registered. Use a signed-in Owner device to issue a one-time localhost enrollment ticket, then register a Passkey in this browser.',
    )
    expect(request).toHaveBeenCalledWith('owner.passkey.authentication.options')
  })

  it('directs remote users to configure a remote Passkey when none is registered', async () => {
    const request = vi.fn().mockRejectedValue(
      new OwnerRequestError({
        code: 'PASSKEY_REQUIRED',
        message: 'A Passkey is required.',
      }),
    )

    await expect(authenticateWithPasskey({ request, close: vi.fn() }, 'remote')).rejects.toThrow(
      'No remote Passkey is registered. Register one from a signed-in Owner device, then try again.',
    )
  })
})
