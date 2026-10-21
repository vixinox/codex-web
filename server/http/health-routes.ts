import type { FastifyInstance } from 'fastify'

import type { RouteContext } from './types.js'

export async function registerHealthRoutes(app: FastifyInstance, { dependencies }: RouteContext) {
  app.get('/metadata', async () => ({
    product: 'codex-web',
    protocolVersion: '2026-01',
    minClientVersion: '0.0.1',
    capabilities: ['threads', 'turns', 'sse', 'pwa', 'workspace'],
  }))
  app.get('/health', async () => ({
    status: 'ok',
    service: 'codex-web-server',
  }))

  app.get('/ready', async (_request, reply) => {
    const eventStoreHealthy = dependencies.codex.events.isHealthy?.() ?? true
    const ready = eventStoreHealthy
    if (!ready) reply.status(503)
    return {
      status: ready ? 'ready' : 'not_ready',
      eventStoreHealthy,
      codexRuntimeManaged: true,
      deployment: 'single-user-single-instance',
    }
  })
}
