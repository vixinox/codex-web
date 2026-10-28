import type {
  IssuedLoginQr,
  OwnerManagementClient,
  OwnerManagementSnapshot,
} from './owner-management-model'

type OwnerRpc = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

function snapshot(value: unknown): OwnerManagementSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid owner management response')
  const body = value as Record<string, unknown>
  const devices = Array.isArray(body.devices)
    ? body.devices.flatMap((deviceValue) => {
        if (!deviceValue || typeof deviceValue !== 'object') return []
        const device = deviceValue as Record<string, unknown>
        if (
          typeof device.id !== 'string' ||
          typeof device.createdAt !== 'string' ||
          !(device.lastSeenAt === null || typeof device.lastSeenAt === 'string')
        )
          return []
        return [{ id: device.id, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt }]
      })
    : []
  return {
    totpEnabled: body.totpEnabled === true,
    recoveryCodesAvailable: body.recoveryCodesAvailable === true,
    initialized: body.initialized === true,
    devices,
  }
}

export function createOwnerManagementClient(rpc: OwnerRpc): OwnerManagementClient {
  return {
    async getSnapshot() {
      return snapshot(await rpc.request('owner.security.status'))
    },
    async setupTotp(password) {
      const result = await rpc.request('owner.security.totp.setup', { password })
      return result as { totpURI?: string }
    },
    async verifyTotp(code) {
      const result = await rpc.request('owner.security.totp.verify', { code })
      return result as { recoveryCodes: string[] }
    },
    async generateRecoveryCodes(password) {
      const result = await rpc.request(
        'owner.security.recovery.rotate',
        password ? { password } : {},
      )
      return result as { recoveryCodes: string[] }
    },
    async acknowledgeRecoveryCodes() {
      await rpc.request('owner.security.recovery.acknowledge')
    },
    async revokeDevice(deviceId) {
      await rpc.request('remote.devices.revoke', { deviceId })
    },
    async resetTrust() {
      await rpc.request('remote.trust.reset')
    },
    async issueLoginQr() {
      const result = await rpc.request('owner.loginQr.issue')
      if (!result || typeof result !== 'object') throw new Error('Invalid login QR response')
      const value = result as Partial<IssuedLoginQr>
      const payload = value.payload
      if (
        !payload ||
        payload.version !== 1 ||
        typeof payload.relayUrl !== 'string' ||
        !/^\d{9}$/u.test(payload.ownerCode) ||
        typeof payload.nodeId !== 'string' ||
        !Number.isSafeInteger(payload.trustEpoch) ||
        typeof payload.ownerPublicKey !== 'string' ||
        typeof payload.ownerPublicKeyFingerprint !== 'string' ||
        typeof payload.capability !== 'string' ||
        typeof value.expiresAt !== 'string'
      )
        throw new Error('Invalid login QR response')
      return value as IssuedLoginQr
    },
    async cancelLoginQr() {
      const result = await rpc.request('owner.loginQr.cancel')
      return result as { cancelled: boolean }
    },
    async loginQrStatus() {
      const result = await rpc.request('owner.loginQr.status')
      if (!result || typeof result !== 'object') throw new Error('Invalid login QR status')
      const value = result as { state?: unknown; expiresAt?: unknown }
      if (
        value.state === 'none' ||
        value.state === 'consumed' ||
        value.state === 'expired' ||
        value.state === 'cancelled' ||
        value.state === 'restarted'
      )
        return { state: value.state }
      if (value.state === 'active' && typeof value.expiresAt === 'string')
        return { state: 'active', expiresAt: value.expiresAt }
      throw new Error('Invalid login QR status')
    },
    close() {
      rpc.close()
    },
  }
}
