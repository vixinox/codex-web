import { describe, expect, it, vi } from 'vitest'
import {
  completeLoginCandidateTwoFactor,
  openLoginCandidateSession,
  type AdmissionConnection,
} from './admission'

function connectionWith(responses: unknown[]): AdmissionConnection & {
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn(async () => responses.shift())
  return { request, close: vi.fn() }
}

describe('remote login candidate', () => {
  it('requires a pending second-factor challenge before submitting any factor', async () => {
    const connection = connectionWith([{ sessionToken: 'unexpected' }])

    await expect(
      openLoginCandidateSession(connection, {
        email: 'owner@example.com',
        password: 'password',
      }),
    ).rejects.toThrow('Owner authentication did not require a second factor.')
    expect(connection.request).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['totp', 'owner.login.verifyTotp'],
    ['recovery', 'owner.login.verifyRecoveryCode'],
  ] as const)('submits a %s factor only against the candidate challenge', async (kind, method) => {
    const connection = connectionWith([
      {
        ownerId: 'owner-1',
        sessionToken: 'session-1',
        expiresAt: '2030-01-01T00:00:00.000Z',
        rollbackToken: 'rollback-1',
        deviceId: 'device-1',
        clientToken: 'client-1',
        trustEpoch: 4,
      },
    ])
    const challenge = { challengeId: 'challenge-1', expiresAt: '2030-01-01T00:05:00.000Z' }

    await expect(
      completeLoginCandidateTwoFactor(connection, challenge, { kind, code: 'factor-code' }),
    ).resolves.toMatchObject({ sessionToken: 'session-1', deviceId: 'device-1' })
    expect(connection.request).toHaveBeenCalledWith(method, {
      challengeId: challenge.challengeId,
      code: 'factor-code',
    })
  })

  it('fails closed when factor verification does not return paired credentials and a session', async () => {
    const connection = connectionWith([{}])

    await expect(
      completeLoginCandidateTwoFactor(
        connection,
        { challengeId: 'challenge-1', expiresAt: '' },
        { kind: 'totp', code: '123456' },
      ),
    ).rejects.toThrow('Owner authentication did not complete.')
  })
})
