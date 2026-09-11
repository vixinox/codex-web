import sensible from '@fastify/sensible'
import Fastify from 'fastify'

import { log, safeError } from '../logger.js'
import { apiError } from './common.js'

export async function createHttpServer() {
  const app = Fastify({ logger: { level: 'error' } })
  await app.register(sensible)
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
