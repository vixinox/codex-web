export type OwnerDevice = {
  id: string
  createdAt: string
  lastSeenAt: string | null
}

export type OwnerManagementSnapshot = {
  remotePasskeyAvailable: boolean
  localPasskeyAvailable: boolean
  recoveryCodesAvailable: boolean
  devices: OwnerDevice[]
}

export type FirstSessionPayload = {
  version: 1
  type: 'first_session'
  relayUrl: string
  ownerCode: string
  nodeId: string
  trustEpoch: number
  ownerPublicKey: string
  ownerPublicKeyFingerprint: string
  ownerPublicKeyVerificationKey: string
  grant: string
  expiresAt: string
}

export type IssuedFirstSession = { payload: FirstSessionPayload }

export type ManagementQr = {
  capability: string
  ownerId: string
  nodeId: string
  trustEpoch: number
  expiresAt: string
}

export type OwnerManagementClient = {
  getSnapshot(): Promise<OwnerManagementSnapshot>
  registerPasskey(ticket?: string): Promise<void>
  generateRecoveryCodes(): Promise<string[]>
  issueLocalEnrollmentTicket(): Promise<{ ticket: string; origin: string; expiresAt: string }>
  revokeDevice(deviceId: string): Promise<void>
  revokeAllSessions(): Promise<void>
  revokeAllDevices(): Promise<void>
  resetTrust(): Promise<void>
  issueFirstSession(): Promise<IssuedFirstSession>
  issueManagementQr(): Promise<ManagementQr>
  cancelManagementQr(): Promise<boolean>
  close(): void
}

export function emptyOwnerManagementSnapshot(): OwnerManagementSnapshot {
  return {
    remotePasskeyAvailable: false,
    localPasskeyAvailable: false,
    recoveryCodesAvailable: false,
    devices: [],
  }
}

export function formatDeviceDate(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}
