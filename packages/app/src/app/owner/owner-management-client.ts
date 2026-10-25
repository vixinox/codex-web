import type { OwnerManagementClient, OwnerManagementSnapshot } from './owner-management-model'

type OwnerRpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>

function snapshot(value: unknown): OwnerManagementSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid owner management response')
  const body = value as Record<string, unknown>
  return {
    totpEnabled: body.totpEnabled === true,
    recoveryCodesAvailable: body.recoveryCodesAvailable === true,
    bindingRequests: Array.isArray(body.bindingRequests) ? body.bindingRequests : [],
    devices: Array.isArray(body.devices) ? body.devices : [],
  } as OwnerManagementSnapshot
}

export function createOwnerManagementClient(rpc: OwnerRpc): OwnerManagementClient {
  return {
    async getSnapshot() {
      return snapshot(await rpc('owner.security.status'))
    },
    async approveBinding(requestId) {
      await rpc('remote.device.binding.approve', { requestId })
    },
    async rejectBinding(requestId) {
      await rpc('remote.device.binding.reject', { requestId })
    },
    async revokeDevice(deviceId) {
      await rpc('remote.devices.revoke', { deviceId })
    },
    async resetTrust() {
      await rpc('remote.trust.reset')
    },
  }
}
