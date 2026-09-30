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
  const requestStartedAt = new WeakMap<object, number>()
  await app.register(sensible)
  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, performance.now())
  })
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
    const route = request.routeOptions.url ?? request.url.split('?', 1)[0]
    if (route === '/api/events' || route === '/guest-api/events') return
    const elapsed = performance.now() - (requestStartedAt.get(request) ?? performance.now())
    const message = `HTTP ${reply.statusCode} ${request.method} ${route} (${elapsed.toFixed(1)}ms, requestId=${safeError(request.id)})`
    if (reply.statusCode >= 300) log.error(message)
    else log.info(message)
  })
  app.setErrorHandler((error, request, reply) => {
    void request
    log.error(`Unhandled request error: ${safeError(error)}`)
    void reply.status(500).send(apiError('INTERNAL_ERROR', 'An unexpected error occurred'))
  })
  return app
}
