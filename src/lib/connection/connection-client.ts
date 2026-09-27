import {
  assessMetadata,
  connectionCapabilities,
  type ConnectionProfile,
  type InstanceMetadata,
} from './connection-profile'

function isMetadata(value: unknown): value is InstanceMetadata {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  return (
    body.product === 'codex-web' &&
    typeof body.protocolVersion === 'string' &&
    typeof body.minClientVersion === 'string' &&
    Array.isArray(body.capabilities) &&
    body.capabilities.every((item) => typeof item === 'string') &&
    (body.profile === 'owner' || body.profile === 'guest')
  )
}

export async function checkCurrentConnection(): Promise<ConnectionProfile> {
  const baseUrl = window.location.origin
  const response = await fetch(`${baseUrl}/metadata`, { credentials: 'include' })
  if (!response.ok) {
    const profile: ConnectionProfile = {
      id: 'current',
      kind: 'self_hosted',
      baseUrl,
      displayName: 'Current instance',
      status: response.status >= 500 ? 'offline' : 'needs_login',
      capabilities: { mobile: false, notifications: false, fileWorkspace: false, guestMode: false },
      errorCode: response.status >= 500 ? 'offline' : 'unavailable',
    }
    return profile
  }
  const body: unknown = await response.json()
  if (!isMetadata(body)) throw new Error('Invalid instance metadata')
  const status = assessMetadata(body)
  return {
    id: 'current',
    kind: body.profile === 'guest' ? 'guest' : 'self_hosted',
    baseUrl,
    displayName: body.profile === 'guest' ? 'Guest instance' : 'Current instance',
    status,
    capabilities: connectionCapabilities(body),
    metadata: body,
    ...(status === 'incompatible' ? { errorCode: 'incompatible' as const } : {}),
  }
}
