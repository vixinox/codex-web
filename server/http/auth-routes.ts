import type { FastifyInstance } from 'fastify'

import { apiError, proxyAuthRequest, requireSession } from './common.js'
import type { RouteContext } from './types.js'

export async function registerAuthRoutes(
  app: FastifyInstance,
  { config, dependencies }: RouteContext,
) {
  app.get('/api/auth/bootstrap', async () => ({
    ownerExists: (await dependencies.workspace.hasOwner?.()) ?? false,
  }))

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      try {
        if (
          request.url.startsWith('/api/auth/sign-up') &&
          dependencies.workspace.hasOwner &&
          (await dependencies.workspace.hasOwner())
        )
          return reply
            .status(409)
            .send(apiError('LOCAL_OWNER_EXISTS', 'A local owner account already exists'))
        return await proxyAuthRequest(request, reply, dependencies.auth, config.authUrl)
      } catch {
        return reply
          .status(500)
          .send(apiError('AUTH_FAILURE', 'Authentication service unavailable'))
      }
    },
  })

  app.get('/api/me', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    return session
  })
}
