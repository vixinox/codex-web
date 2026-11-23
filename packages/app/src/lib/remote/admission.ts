import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import {
  completeConnectionProfile,
  prepareConnectionProfileEnrollment,
  removeConnectionProfile,
} from './device-key-store'
import { createRelayOwnerSocket } from './relay-owner-socket'
import { remoteRelayUrl } from './relay-profile'
import { OwnerRequestError } from '@/lib/owner-ws/owner-runtime'
import { TelemetryErrorCode } from '@codex-web/telemetry/errors'
import { AppLocalError, AppLocalErrorCode } from '@/lib/errors/app-local-error'

export type AdmissionConnection = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  close(reason?: string): void
}

export async function authenticateWithPasskey(
  connection: AdmissionConnection,
  originProfile: 'local' | 'remote',
) {
  let options: { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }
  try {
    options = await connection.request('owner.passkey.authentication.options')
  } catch (error) {
    if (
      error instanceof OwnerRequestError &&
      error.code === TelemetryErrorCode.ownerAuthPasskeyRequired
    ) {
      throw new AppLocalError(
        AppLocalErrorCode.ownerAuthPasskeyRequired,
        originProfile === 'local'
          ? 'No local Passkey is registered. Use a signed-in Owner device to issue a one-time localhost enrollment ticket, then register a Passkey in this browser.'
          : 'No remote Passkey is registered. Register one from a signed-in Owner device, then try again.',
        { cause: error },
      )
    }
    throw error
  }
  const credential = await navigator.credentials.get({
    publicKey: browserRequestOptions(options.options),
  })
  if (!(credential instanceof PublicKeyCredential))
    throw new AppLocalError(
      AppLocalErrorCode.ownerRequestCancelled,
      'Passkey authentication was cancelled.',
    )
  const response = credentialToJson(credential)
  const result = await connection.request<{ token: string; expiresAt: string; ownerId: string }>(
    'owner.passkey.authentication.verify',
    { challengeId: options.challengeId, response },
  )
  if (
    typeof result.token !== 'string' ||
    !result.token ||
    typeof result.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    typeof result.ownerId !== 'string' ||
    !result.ownerId
  )
    throw new AppLocalError(
      AppLocalErrorCode.ownerProtocolInvalidFrame,
      'Passkey authentication returned an invalid session.',
    )
  return { ...result, originProfile }
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

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

const enrollmentAttempts = new Map<string, Promise<{ ownerId: string; profileId: string }>>()

export function redeemEnrollmentOnce(reference: string) {
  const existing = enrollmentAttempts.get(reference)
  if (existing) return existing
  const attempt = redeemEnrollment(reference).finally(() => enrollmentAttempts.delete(reference))
  enrollmentAttempts.set(reference, attempt)
  return attempt
}

async function redeemEnrollment(
  reference: string,
): Promise<{ ownerId: string; profileId: string }> {
  const relayUrl = remoteRelayUrl()
  const profile = await prepareConnectionProfileEnrollment(relayUrl)
  const runtime = createOwnerRuntime(() =>
    createRelayOwnerSocket(relayUrl, {
      clientToken: '',
      publicKey: profile.publicKey,
      privateKey: profile.privateKey,
      enrollmentReference: reference,
      ...(profile.nodeId && profile.trustEpoch !== null
        ? {
            nodeId: profile.nodeId,
            trustEpoch: profile.trustEpoch,
            expectedOwnerPublicKey: profile.ownerPublicKey,
          }
        : {}),
    }),
  )
  try {
    await runtime.connect({ url: relayUrl, clientId: 'owner-enrollment', capabilities: ['owner'] })
    const result = await runtime.request<{
      ownerId: string
      nodeId: string
      ownerPublicKey: string
      deviceId: string
      clientToken: string
      trustEpoch: number
      sessionToken: string
      expiresAt: string
    }>('owner.enrollment.redeem', { reference }, { timeoutMs: 10_000 })
    if (
      typeof result.ownerId !== 'string' ||
      typeof result.nodeId !== 'string' ||
      typeof result.ownerPublicKey !== 'string' ||
      typeof result.deviceId !== 'string' ||
      typeof result.clientToken !== 'string' ||
      !Number.isSafeInteger(result.trustEpoch) ||
      typeof result.sessionToken !== 'string' ||
      typeof result.expiresAt !== 'string'
    )
      throw new Error('Owner returned an invalid enrollment result.')
    await completeConnectionProfile({
      id: profile.id,
      nodeId: result.nodeId,
      ownerId: result.ownerId,
      ownerPublicKey: result.ownerPublicKey,
      deviceId: result.deviceId,
      pairedClientToken: result.clientToken,
      trustEpoch: result.trustEpoch,
      sessionToken: result.sessionToken,
      sessionExpiresAt: result.expiresAt,
    })
    return { ownerId: result.ownerId, profileId: profile.id }
  } catch (cause) {
    if (!profile.deviceId) await removeConnectionProfile(profile.id).catch(() => undefined)
    throw cause
  } finally {
    runtime.close('enrollment complete')
  }
}
