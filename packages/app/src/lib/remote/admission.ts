import {
  createDeviceKey,
  loadDeviceKey,
  restoreDeviceKey,
  saveRemoteOwnerSession,
  setPairedDevice,
  setRemoteTarget,
} from './device-key-store'
import { createRelayOwnerSocket } from './relay-owner-socket'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import type { FirstSessionPayload } from '@/app/owner/owner-management-model'

export type AdmissionConnection = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  close(reason?: string): void
}

export type RemoteLoginResult = {
  ownerId: string
  sessionToken: string
  expiresAt: string
  deviceId: string
  ownerCode: string
  nodeId: string
}

const FIRST_SESSION_CONNECT_TIMEOUT_MS = 10_000

export async function redeemFirstSession(payload: FirstSessionPayload): Promise<RemoteLoginResult> {
  const previous = await loadDeviceKey()
  if (!previous) await createDeviceKey()
  const device = await loadDeviceKey()
  if (!device) throw new Error('Unable to create a remote device key.')
  const socket = createRelayOwnerSocket(payload.relayUrl, {
    clientToken: '',
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    bootstrapReference: payload.reference,
  })
  const runtime = createOwnerRuntime(() => socket)
  try {
    let connectTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        runtime.connect({
          url: payload.relayUrl,
          clientId: 'owner-first-session',
          capabilities: ['owner'],
        }),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(() => {
            runtime.close('first-session connect timeout')
            reject(new Error('FIRST_SESSION_CONNECTION_TIMEOUT'))
          }, FIRST_SESSION_CONNECT_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (connectTimer) clearTimeout(connectTimer)
    }
    const result = await runtime.request<{
      ownerId: string
      sessionToken: string
      expiresAt: string
      deviceId: string
      clientToken: string
      trustEpoch: number
      ownerCode: string
      ownerNodeId: string
    }>('owner.firstSession.redeem', { reference: payload.reference }, { timeoutMs: 10_000 })
    if (
      typeof result.ownerId !== 'string' ||
      typeof result.sessionToken !== 'string' ||
      typeof result.expiresAt !== 'string' ||
      typeof result.deviceId !== 'string' ||
      typeof result.clientToken !== 'string' ||
      !Number.isSafeInteger(result.trustEpoch) ||
      !/^\d{9}$/u.test(result.ownerCode) ||
      typeof result.ownerNodeId !== 'string' ||
      result.ownerNodeId.length === 0
    )
      throw new Error('First-session grant was rejected.')
    await setPairedDevice({
      deviceId: result.deviceId,
      pairedClientToken: result.clientToken,
      trustEpoch: result.trustEpoch,
      nodeId: result.ownerNodeId,
      relayUrl: payload.relayUrl,
    })
    await saveRemoteOwnerSession({
      token: result.sessionToken,
      expiresAt: result.expiresAt,
      relayUrl: payload.relayUrl,
      ownerCode: result.ownerCode,
      nodeId: result.ownerNodeId,
      deviceId: result.deviceId,
      ownerId: result.ownerId,
    })
    await setRemoteTarget({
      nodeId: result.ownerNodeId,
      relayUrl: payload.relayUrl,
      ownerCode: result.ownerCode,
    })
    return {
      ownerId: result.ownerId,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      deviceId: result.deviceId,
      ownerCode: result.ownerCode,
      nodeId: result.ownerNodeId,
    }
  } catch (error) {
    await restoreDeviceKey(previous).catch(() => undefined)
    throw error
  } finally {
    runtime.close('first-session complete')
  }
}

export async function inspectRemoteOwnerFingerprint(input: {
  relayUrl: string
  ownerCode: string
  nodeId: string
  trustEpoch?: number
}) {
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
    onOwnerFingerprint: (value) => {
      observed = value
    },
  })
  const runtime = createOwnerRuntime(() => socket)
  try {
    await runtime.connect({
      url: input.relayUrl,
      clientId: 'owner-fingerprint-check',
      capabilities: ['owner'],
    })
    if (!observed) throw new Error('Owner fingerprint is unavailable.')
    return observed
  } finally {
    runtime.close('fingerprint checked')
  }
}

export async function authenticateWithPasskey(
  connection: AdmissionConnection,
  originProfile: 'local' | 'remote',
) {
  const options = await connection.request<{
    challengeId: string
    options: PublicKeyCredentialRequestOptionsJSON
  }>('owner.passkey.authentication.options')
  const credential = await navigator.credentials.get({
    publicKey: browserRequestOptions(options.options),
  })
  if (!(credential instanceof PublicKeyCredential))
    throw new Error('Passkey authentication was cancelled.')
  const response = credentialToJson(credential)
  const result = await connection.request<{ token: string; expiresAt: string; ownerId?: string }>(
    'owner.passkey.authentication.verify',
    { challengeId: options.challengeId, response },
  )
  return { ...result, originProfile }
}

export async function authenticateWithRecoveryCode(connection: AdmissionConnection, code: string) {
  const reserved = await connection.request<{
    reservationId: string
    registration: { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }
  }>('owner.recovery.login.reserve', { code })
  if (
    !reserved?.reservationId ||
    !reserved.registration?.challengeId ||
    !reserved.registration.options
  )
    throw new Error('Recovery code could not be reserved.')
  const credential = await navigator.credentials.create({
    publicKey: browserCreationOptions(reserved.registration.options),
  })
  if (!(credential instanceof PublicKeyCredential))
    throw new Error('Passkey registration was cancelled. The recovery code remains available.')
  const result = await connection.request<{
    ownerId: string
    sessionToken: string
    expiresAt: string
    deviceId: string
    clientToken: string
    trustEpoch: number
    recoveryCodes: string[]
  }>('owner.recovery.login.finish', {
    reservationId: reserved.reservationId,
    challengeId: reserved.registration.challengeId,
    response: registrationToJson(credential),
  })
  if (
    typeof result.ownerId !== 'string' ||
    typeof result.sessionToken !== 'string' ||
    typeof result.deviceId !== 'string' ||
    typeof result.clientToken !== 'string' ||
    !Number.isSafeInteger(result.trustEpoch) ||
    !Array.isArray(result.recoveryCodes)
  )
    throw new Error('Recovery sign-in returned an invalid session.')
  return result
}

function browserRequestOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: options.allowCredentials?.map((item) => ({
      type: 'public-key' as const,
      id: fromBase64Url(item.id),
      transports: item.transports?.filter(isAuthenticatorTransport),
    })),
  } as unknown as PublicKeyCredentialRequestOptions
}

function browserCreationOptions(
  options: PublicKeyCredentialCreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: { ...options.user, id: fromBase64Url(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map((item) => ({
      type: 'public-key' as const,
      id: fromBase64Url(item.id),
      transports: item.transports?.filter(isAuthenticatorTransport),
    })),
  } as unknown as PublicKeyCredentialCreationOptions
}

function isAuthenticatorTransport(value: string): value is AuthenticatorTransport {
  return ['ble', 'hybrid', 'internal', 'nfc', 'usb'].includes(value)
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function credentialToJson(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: credential.type,
    response: {
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      signature: toBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle ? toBase64Url(new Uint8Array(response.userHandle)) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

function registrationToJson(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: credential.type,
    response: {
      attestationObject: toBase64Url(new Uint8Array(response.attestationObject)),
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}
