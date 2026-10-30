export type OwnerLocalSession = { token: string; ownerId: string; expiresAt: string }

const KEY = 'codex-web:local-owner-session:v1'

export function saveLocalOwnerSession(session: OwnerLocalSession) {
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function readLocalOwnerSession(): OwnerLocalSession | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const session = value as Partial<OwnerLocalSession>
    if (
      typeof session.token !== 'string' ||
      typeof session.ownerId !== 'string' ||
      typeof session.expiresAt !== 'string' ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return session as OwnerLocalSession
  } catch {
    sessionStorage.removeItem(KEY)
    return null
  }
}

export function clearLocalOwnerSession() {
  sessionStorage.removeItem(KEY)
}
