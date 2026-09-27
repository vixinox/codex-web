import sensible from '@fastify/sensible'
import Fastify from 'fastify'

import { log, safeError } from '../logger.js'
import { apiError } from './common.js'

export async function createHttpServer(
  options: {
    trustedOrigins?: readonly string[]
    enforceOriginChecks?: boolean
  } = {},
) {
  const app = Fastify({ logger: { level: 'error' } })
  await app.register(sensible)
  if (options.enforceOriginChecks) {
    const trustedOrigins = new Set(options.trustedOrigins ?? [])
    app.addHook('onRequest', async (request, reply) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return
      const origin = request.headers.origin
      if (typeof origin !== 'string' || !trustedOrigins.has(origin))
        return reply
          .status(403)
          .send(apiError('ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'))
    })
  }
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 300)
      log.error(
        `HTTP ${reply.statusCode} ${request.method} ${safeError(request.url)} (requestId=${safeError(request.id)})`,
      )
  })
  app.setErrorHandler((error, request, reply) => {
    void request
    log.error(`Unhandled request error: ${safeError(error)}`)
    void reply.status(500).send(apiError('INTERNAL_ERROR', 'An unexpected error occurred'))
  })
  return app
}
