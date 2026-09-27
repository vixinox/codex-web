export type ConnectionKind = 'hosted' | 'self_hosted' | 'guest'

export type ConnectionStatus = 'checking' | 'ready' | 'needs_login' | 'offline' | 'incompatible'

export type ConnectionCapabilities = {
  mobile: boolean
  notifications: boolean
  fileWorkspace: boolean
  guestMode: boolean
}

export type InstanceMetadata = {
  product: 'codex-web'
  protocolVersion: string
  minClientVersion: string
  capabilities: string[]
  profile: 'owner' | 'guest'
}

export type ConnectionProfile = {
  id: string
  kind: ConnectionKind
  baseUrl: string
  displayName: string
  status: ConnectionStatus
  capabilities: ConnectionCapabilities
  metadata?: InstanceMetadata
  errorCode?: 'offline' | 'incompatible' | 'unavailable'
}

export const CLIENT_PROTOCOL_VERSION = '2026-01'
export const CLIENT_VERSION = '0.0.1'

function compareVersions(left: string, right: string) {
  const a = left.split('.').map((part) => Number(part))
  const b = right.split('.').map((part) => Number(part))
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

export function connectionCapabilities(metadata: InstanceMetadata): ConnectionCapabilities {
  const available = new Set(metadata.capabilities)
  return {
    mobile: available.has('pwa'),
    notifications: available.has('notifications'),
    fileWorkspace: available.has('workspace'),
    guestMode: available.has('guest'),
  }
}

export function assessMetadata(metadata: InstanceMetadata) {
  if (metadata.product !== 'codex-web') return 'incompatible' as const
  if (metadata.protocolVersion !== CLIENT_PROTOCOL_VERSION) return 'incompatible' as const
  if (compareVersions(metadata.minClientVersion, CLIENT_VERSION) > 0) return 'incompatible' as const
  if (!metadata.capabilities.includes('threads') || !metadata.capabilities.includes('turns'))
    return 'incompatible' as const
  return 'ready' as const
}
