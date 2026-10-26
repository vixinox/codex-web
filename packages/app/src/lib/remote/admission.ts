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

export type ProvisionalSession =
  | { pendingTwoFactor: PendingTwoFactor }
  | { authenticated: true; sessionToken: string; ownerId: string }

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
): Promise<ProvisionalSession> {
  const result = await connection.request<
    { pendingTwoFactor: PendingTwoFactor } | { token: string; session: { user?: { id?: unknown } } }
  >('owner.session.open', credentials)
  if ('pendingTwoFactor' in result) return result
  if (typeof result.token !== 'string' || typeof result.session?.user?.id !== 'string')
    throw new Error('Owner authentication returned an invalid session.')
  return { authenticated: true, sessionToken: result.token, ownerId: result.session.user.id }
}

export async function completeProvisionalTwoFactor(
  connection: AdmissionConnection,
  challenge: PendingTwoFactor,
  factor: { kind: 'totp' | 'recovery'; code: string },
): Promise<{ ownerId: string; sessionToken: string }> {
  const method =
    factor.kind === 'totp'
      ? 'remote.device.binding.verifyTotp'
      : 'remote.device.binding.verifyRecoveryCode'
  const verified = await connection.request<{ sessionToken?: unknown; ownerId?: unknown }>(method, {
    challengeId: challenge.challengeId,
    code: factor.code,
  })
  if (typeof verified.sessionToken !== 'string' || typeof verified.ownerId !== 'string')
    throw new Error('Owner authentication did not complete.')
  return { ownerId: verified.ownerId, sessionToken: verified.sessionToken }
}

export async function authenticateRemoteDevice(input: {
  connection: AdmissionConnection
  credentials: ProvisionalLogin
  factor?: { kind: 'totp' | 'recovery'; code: string }
}): Promise<{ ownerId: string; sessionToken: string }> {
  const provisional = await openProvisionalSession(input.connection, input.credentials)
  let sessionToken = 'sessionToken' in provisional ? provisional.sessionToken : null
  let ownerId = 'ownerId' in provisional ? provisional.ownerId : null
  if ('pendingTwoFactor' in provisional) {
    if (!input.factor?.code) throw new Error('A verification code is required.')
    const verified = await completeProvisionalTwoFactor(
      input.connection,
      provisional.pendingTwoFactor,
      input.factor,
    )
    sessionToken = verified.sessionToken
    ownerId = verified.ownerId
  }
  if (!ownerId) {
    const status = await input.connection.request<{ authenticated?: boolean; ownerId?: string }>(
      'owner.status',
    )
    if (status.authenticated === true && typeof status.ownerId === 'string')
      ownerId = status.ownerId
  }
  if (!sessionToken || !ownerId) throw new Error('Owner authentication did not complete.')
  return { ownerId, sessionToken }
}

export async function promoteProvisionalDevice(input: {
  connection: AdmissionConnection
  credentials: ProvisionalLogin
  factor: { kind: 'totp' | 'recovery'; code: string }
  publicKey: string
  trustEpoch: number
  nodeId?: string
  relayUrl?: string
}): Promise<PairedAdmission & { sessionToken: string }> {
  const authentication = await authenticateRemoteDevice({
    connection: input.connection,
    credentials: input.credentials,
    factor: input.factor,
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
    typeof result.ownerId !== 'string'
  )
    throw new Error('Owner trust promotion returned an invalid result.')
  const trustEpoch = Number.isSafeInteger(result.trustEpoch) ? result.trustEpoch : input.trustEpoch
  await setPairedDevice({
    deviceId: result.deviceId,
    pairedClientToken: result.clientToken,
    trustEpoch,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.relayUrl ? { relayUrl: input.relayUrl } : {}),
  })
  return { ...result, trustEpoch, sessionToken: authentication.sessionToken }
}
