const LOCAL_OWNER_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

export type OwnerTargetKind = 'local' | 'remote'

export function ownerTargetKind(origin: string): OwnerTargetKind {
  return LOCAL_OWNER_ORIGINS.has(origin) ? 'local' : 'remote'
}
