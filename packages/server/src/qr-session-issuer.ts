import type { Auth } from './auth.js'

export type IssuedOwnerSession = {
  token: string
  session: {
    id: string
    expiresAt: string
  }
  user: {
    id: string
    email: string
    name: string
  }
}

/** Creates a regular Better Auth session for a QR capability already consumed by Owner code. */
export async function issueOwnerSessionForConsumedLoginQr(
  auth: Auth,
  userId: string,
): Promise<IssuedOwnerSession> {
  if (!userId) throw new Error('OWNER_USER_REQUIRED')

  const context = await auth.$context
  const user = await context.internalAdapter.findUserById(userId)
  if (!user) throw new Error('OWNER_NOT_FOUND')

  const session = await context.internalAdapter.createSession(userId)
  const resolved = await context.internalAdapter.findSession(session.token)
  if (!resolved || resolved.session.id !== session.id) {
    await context.internalAdapter.deleteSession(session.token)
    throw new Error('OWNER_SESSION_CREATE_FAILED')
  }

  return {
    token: session.token,
    session: { id: session.id, expiresAt: session.expiresAt.toISOString() },
    user: { id: user.id, email: user.email, name: user.name },
  }
}
