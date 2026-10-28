import {
  createDeviceKey,
  loadDeviceKey,
  saveRemoteOwnerSession,
  setPairedDevice,
  setRemoteTarget,
  restoreDeviceKey,
} from './device-key-store'
import { createRelayOwnerSocket } from './relay-owner-socket'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import type { LoginQrPayload } from '@/app/owner/owner-management-model'

export type AdmissionConnection = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  close(reason?: string): void
}

export type RemoteLoginCredentials = {
  email: string
  password: string
}

export type PendingTwoFactor = {
  challengeId: string
  expiresAt: string
}

export type LoginCandidateSession = { pendingTwoFactor: PendingTwoFactor }

export type RemoteLoginResult = {
  ownerId: string
  sessionToken: string
  expiresAt: string
  rollbackToken: string
}

export type PairedAdmission = {
  deviceId: string
  clientToken: string
  trustEpoch: number
  ownerId: string
}

export async function openLoginCandidateSession(
  connection: AdmissionConnection,
  credentials: RemoteLoginCredentials,
): Promise<LoginCandidateSession> {
  const result = await connection.request<{ pendingTwoFactor?: PendingTwoFactor }>(
    'owner.session.open',
    credentials,
  )
  if (!result.pendingTwoFactor)
    throw new Error('Owner authentication did not require a second factor.')
  return { pendingTwoFactor: result.pendingTwoFactor }
}

export async function completeLoginCandidateTwoFactor(
  connection: AdmissionConnection,
  challenge: PendingTwoFactor,
  factor: { kind: 'totp' | 'recovery'; code: string },
): Promise<RemoteLoginResult & PairedAdmission> {
  const method =
    factor.kind === 'totp' ? 'owner.login.verifyTotp' : 'owner.login.verifyRecoveryCode'
  const result = await connection.request<RemoteLoginResult & PairedAdmission>(method, {
    challengeId: challenge.challengeId,
    code: factor.code,
  })
  if (
    typeof result.ownerId !== 'string' ||
    typeof result.sessionToken !== 'string' ||
    typeof result.expiresAt !== 'string' ||
    typeof result.rollbackToken !== 'string' ||
    typeof result.deviceId !== 'string' ||
    typeof result.clientToken !== 'string' ||
    !Number.isSafeInteger(result.trustEpoch)
  )
    throw new Error('Owner authentication did not complete.')
  return result
}

export async function loginToRemoteOwner(input: {
  relayUrl: string
  ownerCode: string
  nodeId: string
  trustEpoch: number
  expectedFingerprint: string
  credentials: RemoteLoginCredentials
  factor: { kind: 'totp' | 'recovery'; code: string }
}): Promise<RemoteLoginResult> {
  const previousRecord = await loadDeviceKey()
  if (!previousRecord) await createDeviceKey()
  const device = await loadDeviceKey()
  if (!device) throw new Error('Unable to create a remote device key.')

  const socket = createRelayOwnerSocket(input.relayUrl, {
    nodeId: input.nodeId,
    trustEpoch: input.trustEpoch,
    clientToken: '',
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    loginOwnerCode: input.ownerCode,
    expectedOwnerFingerprint: input.expectedFingerprint,
  })
  const connection = createOwnerRuntime(() => socket)
  let rollbackToken: string | undefined
  let pairedRuntime: ReturnType<typeof createOwnerRuntime> | undefined
  try {
    await connection.connect({
      url: input.relayUrl,
      clientId: 'owner-remote-login',
      capabilities: ['owner'],
    })
    const opened = await openLoginCandidateSession(connection, input.credentials)
    if (!('pendingTwoFactor' in opened))
      throw new Error('Owner authentication did not require a second factor.')
    const authentication = await completeLoginCandidateTwoFactor(
      connection,
      opened.pendingTwoFactor,
      input.factor,
    )
    rollbackToken = authentication.rollbackToken
    await setPairedDevice({
      deviceId: authentication.deviceId,
      pairedClientToken: authentication.clientToken,
      trustEpoch: authentication.trustEpoch,
      nodeId: input.nodeId,
      relayUrl: input.relayUrl,
    })
    pairedRuntime = await connectPairedOwner({
      relayUrl: input.relayUrl,
      ownerCode: input.ownerCode,
      nodeId: input.nodeId,
      ownerId: authentication.ownerId,
      sessionToken: authentication.sessionToken,
      expiresAt: authentication.expiresAt,
      trustEpoch: authentication.trustEpoch,
    })
    await setRemoteTarget({
      nodeId: input.nodeId,
      relayUrl: input.relayUrl,
      ownerCode: input.ownerCode,
    })
    pairedRuntime.close('remote login complete')
    return authentication
  } catch (error) {
    pairedRuntime?.close('remote login failed')
    if (rollbackToken)
      await connection.request('owner.login.rollback', { rollbackToken }).catch(() => undefined)
    await restoreDeviceKey(previousRecord).catch(() => undefined)
    throw error
  } finally {
    connection.close('remote login complete')
  }
}

export async function inspectRemoteOwnerFingerprint(input: {
  relayUrl: string
  ownerCode: string
  nodeId: string
  trustEpoch?: number
}): Promise<string> {
  const record = await loadDeviceKey()
  if (!record) await createDeviceKey()
  const device = await loadDeviceKey()
  if (!device) throw new Error('Unable to create a remote device key.')
  let observed = ''
  const socket = createRelayOwnerSocket(input.relayUrl, {
    nodeId: input.nodeId,
    trustEpoch: input.trustEpoch ?? 0,
    clientToken: '',
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    loginOwnerCode: input.ownerCode,
    onOwnerFingerprint: (fingerprint) => {
      observed = fingerprint
    },
  })
  const connection = createOwnerRuntime(() => socket)
  try {
    await connection.connect({ url: input.relayUrl, clientId: 'owner-fingerprint-check' })
    if (!observed) throw new Error('Owner fingerprint is unavailable.')
    return observed
  } finally {
    connection.close('fingerprint checked')
  }
}

export async function redeemLoginQr(payload: LoginQrPayload): Promise<RemoteLoginResult> {
  const fingerprint = await fingerprintOwnerKey(payload.ownerPublicKey)
  if (fingerprint !== payload.ownerPublicKeyFingerprint)
    throw new Error('Login QR Owner fingerprint is invalid.')
  const previousRecord = await loadDeviceKey()
  const record = previousRecord
  if (!record) await createDeviceKey()
  const device = await loadDeviceKey()
  if (!device) throw new Error('Unable to create a remote device key.')
  const socket = createRelayOwnerSocket(payload.relayUrl, {
    nodeId: payload.nodeId,
    trustEpoch: payload.trustEpoch,
    clientToken: '',
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    loginOwnerCode: payload.ownerCode,
    expectedOwnerFingerprint: payload.ownerPublicKeyFingerprint,
  })
  const connection = createOwnerRuntime(() => socket)
  let rollbackToken: string | undefined
  let pairedRuntime: ReturnType<typeof createOwnerRuntime> | undefined
  try {
    await connection.connect({ url: payload.relayUrl, clientId: 'owner-remote-qr-login' })
    const result = await connection.request<{
      ownerId: string
      sessionToken: string
      expiresAt: string
      deviceId: string
      clientToken: string
      trustEpoch: number
      rollbackToken: string
    }>('owner.loginQr.redeem', { capability: payload.capability })
    if (
      typeof result.ownerId !== 'string' ||
      typeof result.sessionToken !== 'string' ||
      typeof result.expiresAt !== 'string' ||
      typeof result.deviceId !== 'string' ||
      typeof result.clientToken !== 'string' ||
      !Number.isSafeInteger(result.trustEpoch) ||
      typeof result.rollbackToken !== 'string'
    )
      throw new Error('Owner QR login did not complete.')
    rollbackToken = result.rollbackToken
    await setPairedDevice({
      deviceId: result.deviceId,
      pairedClientToken: result.clientToken,
      trustEpoch: result.trustEpoch,
      nodeId: payload.nodeId,
      relayUrl: payload.relayUrl,
    })
    pairedRuntime = await connectPairedOwner({
      relayUrl: payload.relayUrl,
      ownerCode: payload.ownerCode,
      nodeId: payload.nodeId,
      ownerId: result.ownerId,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      trustEpoch: result.trustEpoch,
    })
    await setRemoteTarget({
      nodeId: payload.nodeId,
      relayUrl: payload.relayUrl,
      ownerCode: payload.ownerCode,
    })
    pairedRuntime.close('QR login complete')
    return {
      ownerId: result.ownerId,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      rollbackToken: result.rollbackToken,
    }
  } catch (error) {
    pairedRuntime?.close('QR login failed')
    if (rollbackToken)
      await connection.request('owner.login.rollback', { rollbackToken }).catch(() => undefined)
    await restoreDeviceKey(previousRecord).catch(() => undefined)
    throw error
  } finally {
    connection.close('QR login complete')
  }
}

async function connectPairedOwner(input: {
  relayUrl: string
  ownerCode: string
  nodeId: string
  ownerId: string
  sessionToken: string
  expiresAt: string
  trustEpoch: number
}) {
  const record = await loadDeviceKey()
  if (!record?.deviceId || !record.pairedClientToken)
    throw new Error('Paired device credentials are unavailable.')
  const socket = createRelayOwnerSocket(input.relayUrl, {
    nodeId: input.nodeId,
    trustEpoch: input.trustEpoch,
    clientToken: record.pairedClientToken,
    deviceId: record.deviceId,
    publicKey: record.publicKey,
    privateKey: record.privateKey,
  })
  const runtime = createOwnerRuntime(() => socket)
  try {
    await runtime.connect({
      url: input.relayUrl,
      clientId: 'owner-remote-app',
      capabilities: ['owner', 'remote-administration'],
      sessionToken: input.sessionToken,
    })
    if (!runtime.authenticated) throw new Error('Paired Owner admission was rejected.')
    await saveRemoteOwnerSession({
      token: input.sessionToken,
      expiresAt: input.expiresAt,
      relayUrl: input.relayUrl,
      ownerCode: input.ownerCode,
      nodeId: input.nodeId,
      deviceId: record.deviceId,
      ownerId: input.ownerId,
    })
    return runtime
  } catch (error) {
    runtime.close('paired admission failed')
    throw error
  }
}

async function fingerprintOwnerKey(serializedPublicKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serializedPublicKey),
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
    .slice(0, 16)
}
