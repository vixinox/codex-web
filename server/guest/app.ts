import type { ServerConfig } from '../config.js'
import type { GuestService } from '../guest-service.js'
import { createHttpServer } from '../http/server-base.js'
import { registerGuestRoutes } from '../http/guest-routes.js'
import { registerAdminRoutes } from '../http/admin-routes.js'
import type { Auth } from '../auth.js'
import { proxyAuthRequest, requireSession, apiError } from '../http/common.js'
import type { Database } from '../database.js'

export async function buildGuestServer(
  config: ServerConfig,
  guest: GuestService,
  auth: Auth,
  db: Database,
) {
  const app = await createHttpServer()
  app.get('/health', async () => ({
    status: 'ok',
    service: 'codex-web-guest',
    codexRuntimeVersion: config.codexRuntimeVersion,
  }))
  app.get('/runtime-profile', async () => ({ profile: 'guest' }))
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      if (request.url.split('?', 1)[0] === '/api/auth/sign-out') {
        return reply
          .status(404)
          .send(apiError('AUTH_ROUTE_NOT_FOUND', 'Authentication route not found'))
      }
      try {
        return await proxyAuthRequest(request, reply, auth, config.authUrl)
      } catch {
        return reply
          .status(500)
          .send(apiError('AUTH_FAILURE', 'Authentication service unavailable'))
      }
    },
  })
  app.get('/api/me', async (request, reply) => {
    const session = await requireSession(request, reply, auth)
    return session ?? undefined
  })
  app.get('/ready', async (_request, reply) => {
    const ready = guest.runtime().status === 'ready'
    if (!ready) reply.status(503)
    return { status: ready ? 'ready' : 'not_ready', runtime: guest.runtime() }
  })
  await registerGuestRoutes(app, { dependencies: { guest }, auth })
  await registerAdminRoutes(app, { service: guest, auth, db, profile: 'guest' })
  return app
}
