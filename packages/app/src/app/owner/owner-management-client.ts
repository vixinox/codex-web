import type { OwnerManagementClient, OwnerManagementSnapshot } from './owner-management-model'
import { parseEnrollmentInvitation } from './owner-management-model'
import { authenticateWithPasskey } from '@/lib/remote/admission'

type OwnerRpc = {
  requirePasskeyStepUp?: boolean
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  close(): void
}

function snapshot(value: unknown): OwnerManagementSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid owner security response')
  const body = value as Record<string, unknown>
  const devices = Array.isArray(body.devices)
    ? body.devices.flatMap((deviceValue) => {
        if (!deviceValue || typeof deviceValue !== 'object') return []
        const device = deviceValue as Record<string, unknown>
        if (typeof device.id !== 'string' || typeof device.createdAt !== 'string') return []
        if (!(device.lastSeenAt === null || typeof device.lastSeenAt === 'string')) return []
        return [{ id: device.id, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt }]
      })
    : []
  return {
    remotePasskeyAvailable: body.remotePasskeyAvailable === true,
    localPasskeyAvailable: body.localPasskeyAvailable === true,
    devices,
  }
}

export function createOwnerManagementClient(rpc: OwnerRpc): OwnerManagementClient {
  let remotePasskeyAvailable = false
  return {
    async getSnapshot() {
      const value = snapshot(await rpc.request('owner.security.status'))
      remotePasskeyAvailable = value.remotePasskeyAvailable
      return value
    },
    async registerPasskey(ticket) {
      const options = (await rpc.request(
        'owner.passkey.registration.options',
        ticket ? { ticket } : undefined,
      )) as {
        challengeId?: unknown
        options?: PublicKeyCredentialCreationOptionsJSON
      }
      if (typeof options.challengeId !== 'string' || !options.options)
        throw new Error('Invalid Passkey registration options')
      const credential = await navigator.credentials.create({
        publicKey: browserCreationOptions(options.options),
      })
      if (!(credential instanceof PublicKeyCredential))
        throw new Error('Passkey registration was cancelled')
      await rpc.request('owner.passkey.registration.verify', {
        challengeId: options.challengeId,
        response: registrationToJson(credential),
        ...(ticket ? { ticket } : {}),
      })
    },
    async issueLocalEnrollmentTicket() {
      const value = (await rpc.request('owner.localEnrollment.issue')) as Record<string, unknown>
      if (
        typeof value.ticket !== 'string' ||
        typeof value.origin !== 'string' ||
        typeof value.expiresAt !== 'string'
      )
        throw new Error('Invalid local enrollment ticket')
      return { ticket: value.ticket, origin: value.origin, expiresAt: value.expiresAt }
    },
    async revokeDevice(deviceId) {
      await rpc.request('remote.devices.revoke', { deviceId })
    },
    async revokeAllSessions() {
      await rpc.request('owner.remoteSessions.revokeAll')
    },
    async revokeAllDevices() {
      await rpc.request('remote.devices.revokeAll')
    },
    async resetTrust() {
      await rpc.request('remote.trust.reset')
    },
    async issueEnrollment() {
      if (rpc.requirePasskeyStepUp && remotePasskeyAvailable) {
        await authenticateWithPasskey(rpc, 'remote')
      }
      const value = await rpc.request('owner.enrollment.issue')
      return parseEnrollmentInvitation(value)
    },
    async getEnrollmentStatus() {
      const value = (await rpc.request('owner.enrollment.status')) as Record<string, unknown>
      if (value.active === false) return null
      if (value.active === true) return parseEnrollmentInvitation(value.invitation ?? value)
      throw new Error('Invalid enrollment status response')
    },
    async cancelEnrollment() {
      const value = (await rpc.request('owner.enrollment.cancel')) as Record<string, unknown>
      if (typeof value.cancelled !== 'boolean')
        throw new Error('Invalid enrollment cancellation response')
      return value.cancelled
    },
    close() {
      rpc.close()
    },
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

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}
