import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { Auth } from '../auth.js'

export function apiError(code: string, message: string) {
  return { error: { code, message } }
}

export function authHeaders(request: FastifyRequest) {
  const headers = fromNodeHeaders(request.headers)
  headers.set('x-codex-web-client-ip', request.ip)
  return headers
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply, auth: Auth) {
  const session = await auth.api.getSession({ headers: authHeaders(request) })
  if (!session) {
    await reply.status(401).send(apiError('UNAUTHORIZED', 'Authentication required'))
    return null
  }
  return session
}
