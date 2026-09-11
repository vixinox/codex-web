import type { FastifyInstance } from 'fastify'

import type { RouteContext } from './types.js'

export async function registerHealthRoutes(
  app: FastifyInstance,
  { config, dependencies }: RouteContext,
) {
  app.get('/runtime-profile', async () => ({ profile: config.mode }))
  app.get('/health', async () => ({
    status: 'ok',
    service: 'codex-web-server',
    codexRuntimeVersion: config.codexRuntimeVersion,
  }))

  app.get('/ready', async (_request, reply) => {
    const eventStoreHealthy = dependencies.codex.events.isHealthy?.() ?? true
    const ready = eventStoreHealthy
    if (!ready) reply.status(503)
    return {
      status: ready ? 'ready' : 'not_ready',
      eventStoreHealthy,
      codexRuntimeVersion: config.codexRuntimeVersion,
      codexRuntimeManaged: true,
      deployment: 'single-user-single-instance',
    }
  })
}
