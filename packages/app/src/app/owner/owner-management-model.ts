export type OwnerDevice = {
  id: string
  createdAt: string
  lastSeenAt: string | null
}

export type BindingRequest = {
  requestId: string
  source: string
  createdAt: string
  publicKeyFingerprint: string
  expiresAt: string
}

export type OwnerManagementSnapshot = {
  totpEnabled: boolean
  recoveryCodesAvailable: boolean
  bindingRequests: BindingRequest[]
  devices: OwnerDevice[]
}

export type OwnerManagementClient = {
  getSnapshot(): Promise<OwnerManagementSnapshot>
  approveBinding(requestId: string): Promise<void>
  rejectBinding?(requestId: string): Promise<void>
  revokeDevice(deviceId: string): Promise<void>
  resetTrust(): Promise<void>
}

export function emptyOwnerManagementSnapshot(): OwnerManagementSnapshot {
  return { totpEnabled: false, recoveryCodesAvailable: false, bindingRequests: [], devices: [] }
}

export function formatDeviceDate(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}
