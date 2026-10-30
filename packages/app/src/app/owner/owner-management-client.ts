import type {
  FirstSessionPayload,
  IssuedFirstSession,
  OwnerManagementClient,
  OwnerManagementSnapshot,
} from './owner-management-model'

type OwnerRpc = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

function snapshot(value: unknown): OwnerManagementSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid owner security response')
  const body = value as Record<string, unknown>
  const devices = Array.isArray(body.devices)
    ? body.devices.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const device = value as Record<string, unknown>
        if (typeof device.id !== 'string' || typeof device.createdAt !== 'string') return []
        if (!(device.lastSeenAt === null || typeof device.lastSeenAt === 'string')) return []
        return [{ id: device.id, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt }]
      })
    : []
  return {
    remotePasskeyAvailable: body.remotePasskeyAvailable === true,
    localPasskeyAvailable: body.localPasskeyAvailable === true,
    recoveryCodesAvailable: body.recoveryCodesAvailable === true,
    devices,
  }
}

export function createOwnerManagementClient(rpc: OwnerRpc): OwnerManagementClient {
  return {
    async getSnapshot() {
      return snapshot(await rpc.request('owner.security.status'))
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
    async generateRecoveryCodes() {
      const result = (await rpc.request('owner.recovery.generate')) as { recoveryCodes?: unknown }
      if (
        !Array.isArray(result.recoveryCodes) ||
        !result.recoveryCodes.every((code) => typeof code === 'string')
      )
        throw new Error('Invalid recovery code response')
      return result.recoveryCodes
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
    async issueFirstSession() {
      const value = (await rpc.request('owner.bootstrap.issue')) as Record<string, unknown>
      const payload = value.payload as Partial<FirstSessionPayload> | undefined
      if (
        !payload ||
        payload.version !== 1 ||
        payload.type !== 'first_session' ||
        typeof payload.relayUrl !== 'string' ||
        !/^\d{9}$/u.test(payload.ownerCode ?? '') ||
        typeof payload.nodeId !== 'string' ||
        !Number.isSafeInteger(payload.trustEpoch) ||
        typeof payload.ownerPublicKey !== 'string' ||
        typeof payload.ownerPublicKeyVerificationKey !== 'string' ||
        typeof payload.ownerPublicKeyFingerprint !== 'string' ||
        typeof payload.grant !== 'string' ||
        typeof payload.expiresAt !== 'string'
      )
        throw new Error('Invalid first-session response')
      return { payload: payload as FirstSessionPayload } satisfies IssuedFirstSession
    },
    async issueManagementQr() {
      const value = (await rpc.request('remote.loginQr.issue')) as Record<string, unknown>
      if (
        typeof value.capability !== 'string' ||
        typeof value.ownerId !== 'string' ||
        typeof value.nodeId !== 'string' ||
        !Number.isSafeInteger(value.trustEpoch) ||
        typeof value.expiresAt !== 'string'
      )
        throw new Error('Invalid management QR response')
      return {
        capability: value.capability,
        ownerId: value.ownerId,
        nodeId: value.nodeId,
        trustEpoch: value.trustEpoch as number,
        expiresAt: value.expiresAt,
      }
    },
    async cancelManagementQr() {
      const value = (await rpc.request('remote.loginQr.cancel')) as Record<string, unknown>
      if (typeof value.cancelled !== 'boolean') throw new Error('Invalid management QR response')
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
