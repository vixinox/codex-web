export function requiresProfileReset(
  previous: string | null,
  current: 'owner' | 'guest',
  userKind: string | undefined,
) {
  if (previous && previous !== current) return true
  if (!userKind) return false
  return current === 'owner' ? userKind !== 'owner' : userKind !== 'guest' && userKind !== 'admin'
}
