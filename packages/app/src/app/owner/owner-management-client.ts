import type { OwnerManagementClient, OwnerManagementSnapshot } from './owner-management-model'

type OwnerRpc = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

function snapshot(value: unknown): OwnerManagementSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid owner management response')
  const body = value as Record<string, unknown>
  const bindingRequests = Array.isArray(body.bindingRequests)
    ? body.bindingRequests.flatMap((entryValue) => {
        if (!entryValue || typeof entryValue !== 'object') return []
        const request = entryValue as Record<string, unknown>
        if (
          typeof request.requestId !== 'string' ||
          typeof request.source !== 'string' ||
          typeof request.createdAt !== 'string' ||
          typeof request.publicKeyFingerprint !== 'string' ||
          typeof request.expiresAt !== 'string'
        )
          return []
        return [
          {
            requestId: request.requestId,
            source: request.source,
            createdAt: request.createdAt,
            publicKeyFingerprint: request.publicKeyFingerprint,
            expiresAt: request.expiresAt,
          },
        ]
      })
    : []
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
    bindingRequests,
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
    async approveBinding(requestId) {
      await rpc.request('remote.device.binding.approve', { requestId })
    },
    async rejectBinding(requestId) {
      await rpc.request('remote.device.binding.reject', { requestId })
    },
    async revokeDevice(deviceId) {
      await rpc.request('remote.devices.revoke', { deviceId })
    },
    async resetTrust() {
      await rpc.request('remote.trust.reset')
    },
    close() {
      rpc.close()
    },
  }
}
