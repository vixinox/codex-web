export type OwnerDevice = {
  id: string
  createdAt: string
  lastSeenAt: string | null
}

export type OwnerManagementSnapshot = {
  remotePasskeyAvailable: boolean
  localPasskeyAvailable: boolean
  devices: OwnerDevice[]
}

export type EnrollmentInvitation = {
  reference: string
  expiresAt: string
}

export function parseEnrollmentInvitation(value: unknown): EnrollmentInvitation {
  const source =
    value && typeof value === 'object' && 'invitation' in value
      ? (value as { invitation?: unknown }).invitation
      : value
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Invalid enrollment invitation response')
  const invitation = source as Record<string, unknown>
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

export type OwnerManagementClient = {
  getSnapshot(): Promise<OwnerManagementSnapshot>
  registerPasskey(ticket?: string): Promise<void>
  issueLocalEnrollmentTicket(): Promise<{ ticket: string; origin: string; expiresAt: string }>
  revokeDevice(deviceId: string): Promise<void>
  revokeAllSessions(): Promise<void>
  revokeAllDevices(): Promise<void>
  resetTrust(): Promise<void>
  issueEnrollment(): Promise<EnrollmentInvitation>
  getEnrollmentStatus(): Promise<EnrollmentInvitation | null>
  cancelEnrollment(): Promise<boolean>
  close(): void
}

export function emptyOwnerManagementSnapshot(): OwnerManagementSnapshot {
  return {
    remotePasskeyAvailable: false,
    localPasskeyAvailable: false,
    devices: [],
  }
}

export function formatDeviceDate(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}
