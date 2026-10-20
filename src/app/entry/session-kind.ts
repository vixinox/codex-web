export function getSessionKind(user: unknown): string | undefined {
  if (typeof user !== 'object' || user === null || !('kind' in user)) return undefined

  const kind = user.kind
  return typeof kind === 'string' ? kind : undefined
}
