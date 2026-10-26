import { setPairedDevice } from './device-key-store'

export type AdmissionConnection = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  close(reason?: string): void
}

export type ProvisionalLogin = {
  email: string
  password: string
}

export type PendingTwoFactor = {
  challengeId: string
  expiresAt: string
}

export type PairedAdmission = {
  deviceId: string
  clientToken: string
  trustEpoch: number
  ownerId: string
}

export type AdmissionState =
  | { status: 'idle' }
  | { status: 'authenticating' }
  | { status: 'pending_totp'; challenge: PendingTwoFactor }
  | { status: 'trusted'; result: PairedAdmission }
  | { status: 'failed'; message: string }

export async function openProvisionalSession(
  connection: AdmissionConnection,
  credentials: ProvisionalLogin,
): Promise<PendingTwoFactor | { authenticated: true }> {
  const result = await connection.request<
    { pendingTwoFactor: PendingTwoFactor } | { token: string; session: unknown }
  >('owner.session.open', credentials)
  if ('pendingTwoFactor' in result) return result.pendingTwoFactor
  return { authenticated: true }
}

export async function promoteProvisionalDevice(input: {
  connection: AdmissionConnection
  credentials: ProvisionalLogin
  factor: { kind: 'totp' | 'recovery'; code: string }
  publicKey: string
  trustEpoch: number
}): Promise<PairedAdmission> {
  const pending = await openProvisionalSession(input.connection, input.credentials)
  if (!('challengeId' in pending)) {
    throw new Error('Owner authentication did not require a binding challenge.')
  }
  const method =
    input.factor.kind === 'totp'
      ? 'remote.device.binding.verifyTotp'
      : 'remote.device.binding.verifyRecoveryCode'
  await input.connection.request(method, {
    challengeId: pending.challengeId,
    code: input.factor.code,
  })
  const challenge = await input.connection.request<{ challenge: string }>('remote.device.trust', {
    publicKey: input.publicKey,
  })
  const result = await input.connection.request<PairedAdmission>('remote.device.trust', {
    publicKey: input.publicKey,
    challenge: challenge.challenge,
  })
  if (
    !result ||
    typeof result.deviceId !== 'string' ||
    typeof result.clientToken !== 'string' ||
    !Number.isSafeInteger(result.trustEpoch) ||
    typeof result.ownerId !== 'string'
  )
    throw new Error('Owner trust promotion returned an invalid result.')
  await setPairedDevice({
    deviceId: result.deviceId,
    pairedClientToken: result.clientToken,
    trustEpoch: result.trustEpoch,
  })
  return result
}
