export type OwnerDevice = {
  id: string
  createdAt: string
  lastSeenAt: string | null
}

export type OwnerManagementSnapshot = {
  totpEnabled: boolean
  recoveryCodesAvailable: boolean
  initialized: boolean
  devices: OwnerDevice[]
}

export type LoginQrPayload = {
  version: 1
  relayUrl: string
  ownerCode: string
  nodeId: string
  trustEpoch: number
  ownerPublicKey: string
  ownerPublicKeyFingerprint: string
  capability: string
}

export type IssuedLoginQr = { payload: LoginQrPayload; expiresAt: string }

export type OwnerManagementClient = {
  getSnapshot(): Promise<OwnerManagementSnapshot>
  setupTotp(password: string): Promise<{ totpURI?: string }>
  verifyTotp(code: string): Promise<{ recoveryCodes: string[] }>
  generateRecoveryCodes(password?: string): Promise<{ recoveryCodes: string[] }>
  acknowledgeRecoveryCodes(): Promise<void>
  revokeDevice(deviceId: string): Promise<void>
  resetTrust(): Promise<void>
  issueLoginQr(): Promise<IssuedLoginQr>
  cancelLoginQr(): Promise<{ cancelled: boolean }>
  loginQrStatus(): Promise<{
    state: 'active' | 'none' | 'consumed' | 'expired' | 'cancelled' | 'restarted'
    expiresAt?: string
  }>
  close(): void
}

export function emptyOwnerManagementSnapshot(): OwnerManagementSnapshot {
  return { totpEnabled: false, recoveryCodesAvailable: false, initialized: false, devices: [] }
}

export function formatDeviceDate(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}
