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
  reference: string
  /** Relay URL comes from the trusted application profile, never from QR contents. */
  relayUrl: string
  expiresAt: string
}

export type IssuedFirstSession = { payload: FirstSessionPayload }

export type ManagementQr = {
  reference: string
  expiresAt: string
}

export type ManagementQrPayload = {
  version: 1
  type: 'management_request'
  reference: string
  expiresAt: string
}

export function parseManagementQrPayload(raw: string): ManagementQrPayload {
  let value: unknown
  try {
    value = JSON.parse(raw.trim())
  } catch {
    throw new Error('This is not a valid management QR.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('This is not a valid management QR.')
  const payload = value as Record<string, unknown>
  if (
    Object.keys(payload).some(
      (key) => !['version', 'type', 'reference', 'expiresAt'].includes(key),
    ) ||
    payload.version !== 1 ||
    payload.type !== 'management_request' ||
    typeof payload.reference !== 'string' ||
    !/^[A-Za-z0-9_-]{16,256}$/u.test(payload.reference) ||
    typeof payload.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.expiresAt)) ||
    Date.parse(payload.expiresAt) <= Date.now()
  )
    throw new Error('This management QR is invalid or expired.')
  return payload as ManagementQrPayload
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
  consumeManagementQr(
    reference: string,
  ): Promise<{ consumed: true; ownerId: string; nodeId: string; trustEpoch: number }>
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
