import type { FastifyInstance } from 'fastify'

import type { RouteContext } from './types.js'

export async function registerAuthRoutes(app: FastifyInstance, { dependencies }: RouteContext) {
  app.get('/api/auth/bootstrap', async () => ({
    ownerExists: (await dependencies.workspace.hasOwner?.()) ?? false,
  }))
}
