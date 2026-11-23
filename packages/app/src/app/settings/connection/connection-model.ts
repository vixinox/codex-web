export type RemoteDevice = {
  id: string
  createdAt: string
  lastSeenAt: string | null
}

export type ConnectionSnapshot = {
  remotePasskeyAvailable: boolean
  localPasskeyAvailable: boolean
  currentDeviceId: string | null
  devices: RemoteDevice[]
}

export type EnrollmentInvitation = {
  reference: string
  expiresAt: string
}

export function parseEnrollmentInvitation(value: unknown): EnrollmentInvitation {
  const source = isRecord(value) && 'invitation' in value ? value.invitation : value
  if (!isRecord(source)) throw new Error('Invalid enrollment invitation response')
  const invitation = source
  if (
    Object.keys(invitation).some(
      (key) => !['reference', 'expiresAt', 'active', 'consumed', 'issuer'].includes(key),
    ) ||
    typeof invitation.reference !== 'string' ||
    !/^[A-Za-z0-9_-]{16,256}$/u.test(invitation.reference) ||
    typeof invitation.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(invitation.expiresAt))
  )
    throw new Error('Invalid enrollment invitation response')
  return {
    reference: invitation.reference,
    expiresAt: invitation.expiresAt,
  }
}

export type ConnectionClient = {
  getSnapshot(): Promise<ConnectionSnapshot>
  registerPasskey(ticket?: string): Promise<void>
  issueLocalEnrollmentTicket(): Promise<{ ticket: string; origin: string; expiresAt: string }>
  revokeDevice(deviceId: string): Promise<void>
  revokeAllDevices(): Promise<void>
  issueEnrollment(): Promise<EnrollmentInvitation>
  getEnrollmentStatus(): Promise<EnrollmentInvitation | null>
  cancelEnrollment(): Promise<boolean>
  close(): void
}

export function emptyConnectionSnapshot(): ConnectionSnapshot {
  return {
    remotePasskeyAvailable: false,
    localPasskeyAvailable: false,
    currentDeviceId: null,
    devices: [],
  }
}

export function formatDeviceDate(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
