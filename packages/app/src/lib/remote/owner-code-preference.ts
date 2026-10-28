const OWNER_CODE_KEY = 'codex-web:recent-owner-code'
const OWNER_CODE_EDITABLE_KEY = 'codex-web:owner-code-editable'
const OWNER_FINGERPRINTS_KEY = 'codex-web:owner-fingerprints'
const OWNER_TARGET_KEY = 'codex-web:recent-owner-target'

export type OwnerCodeAvailability = 'idle' | 'checking' | 'online' | 'offline' | 'unreachable'

export function readOwnerCodePreference(storage: Pick<Storage, 'getItem'> = localStorage) {
  const target = readRecentOwnerTarget(storage)
  const ownerCode = target?.ownerCode ?? storage.getItem(OWNER_CODE_KEY)
  return {
    ownerCode: ownerCode && /^\d{9}$/u.test(ownerCode) ? ownerCode : '',
    editable: storage.getItem(OWNER_CODE_EDITABLE_KEY) === 'true',
    target,
  }
}

export type RecentOwnerTarget = { relayUrl: string; ownerCode: string; nodeId: string }

export function readRecentOwnerTarget(
  storage: Pick<Storage, 'getItem'> = localStorage,
): RecentOwnerTarget | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(OWNER_TARGET_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const target = value as Partial<RecentOwnerTarget>
    if (
      typeof target.relayUrl !== 'string' ||
      !/^wss?:/u.test(target.relayUrl) ||
      typeof target.ownerCode !== 'string' ||
      !/^\d{9}$/u.test(target.ownerCode) ||
      typeof target.nodeId !== 'string' ||
      !target.nodeId
    )
      return null
    return target as RecentOwnerTarget
  } catch {
    return null
  }
}

export function saveRecentOwnerTarget(
  target: RecentOwnerTarget,
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  if (!/^\d{9}$/u.test(target.ownerCode) || !/^wss?:/u.test(target.relayUrl) || !target.nodeId)
    throw new Error('Owner target is invalid.')
  storage.setItem(OWNER_TARGET_KEY, JSON.stringify(target))
  storage.setItem(OWNER_CODE_KEY, target.ownerCode)
}

export function saveRecentOwnerCode(
  ownerCode: string,
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  if (!/^\d{9}$/u.test(ownerCode)) throw new Error('Owner code must contain 9 digits.')
  storage.setItem(OWNER_CODE_KEY, ownerCode)
}

export function unlockOwnerCodeEditing(storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(OWNER_CODE_EDITABLE_KEY, 'true')
}

export function readKnownOwnerFingerprint(
  relayUrl: string,
  nodeId: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
) {
  try {
    const records = JSON.parse(storage.getItem(OWNER_FINGERPRINTS_KEY) ?? '{}') as Record<
      string,
      unknown
    >
    const value = records[fingerprintKey(relayUrl, nodeId)]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

export function rememberOwnerFingerprint(
  relayUrl: string,
  nodeId: string,
  fingerprint: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  const records = JSON.parse(storage.getItem(OWNER_FINGERPRINTS_KEY) ?? '{}') as Record<
    string,
    unknown
  >
  records[fingerprintKey(relayUrl, nodeId)] = fingerprint
  storage.setItem(OWNER_FINGERPRINTS_KEY, JSON.stringify(records))
}

function fingerprintKey(relayUrl: string, nodeId: string) {
  return `${relayUrl}\u0000${nodeId}`
}

export async function checkOwnerCodeAvailability(input: {
  relayUrl: string
  ownerCode: string
  fetcher?: typeof fetch
}): Promise<
  { status: 'online'; nodeId: string; trustEpoch: number } | { status: 'offline' | 'unreachable' }
> {
  if (!/^\d{9}$/u.test(input.ownerCode)) throw new Error('Owner code must contain 9 digits.')
  let url: URL
  try {
    url = new URL(input.relayUrl)
    if (url.protocol === 'wss:') url.protocol = 'https:'
    else if (url.protocol === 'ws:') url.protocol = 'http:'
    else if (url.protocol !== 'https:' && url.protocol !== 'http:') return { status: 'unreachable' }
    url.pathname = `/owner-code/${input.ownerCode}`
    url.search = ''
    url.hash = ''
  } catch {
    return { status: 'unreachable' }
  }
  const fetcher = input.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(url, { headers: { accept: 'application/json' } })
  } catch {
    return { status: 'unreachable' }
  }
  if (!response.ok) return { status: response.status >= 500 ? 'unreachable' : 'offline' }
  try {
    const body: unknown = await response.json()
    if (
      body &&
      typeof body === 'object' &&
      (body as { online?: unknown }).online === true &&
      typeof (body as { nodeId?: unknown }).nodeId === 'string' &&
      Number.isSafeInteger((body as { trustEpoch?: unknown }).trustEpoch)
    )
      return {
        status: 'online',
        nodeId: (body as { nodeId: string }).nodeId,
        trustEpoch: (body as { trustEpoch: number }).trustEpoch,
      }
    if (body && typeof body === 'object' && (body as { online?: unknown }).online === false)
      return { status: 'offline' }
    return { status: 'unreachable' }
  } catch {
    return { status: 'unreachable' }
  }
}
