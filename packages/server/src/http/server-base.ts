import sensible from '@fastify/sensible'
import Fastify from 'fastify'
import type { FastifyBaseLogger } from 'fastify'

import { getFastifyLogger, getServerLogger } from '../logger.js'
import { OwnerMethodError, projectOwnerError } from '../owner/errors.js'

export async function createHttpServer(
  options: {
    trustedOrigins?: readonly string[]
    enforceOriginChecks?: boolean
    logger?: ReturnType<typeof getServerLogger>
  } = {},
) {
  const logger = options.logger ?? getServerLogger()
  const app = Fastify({
    loggerInstance: getFastifyLogger() as unknown as FastifyBaseLogger,
    logController: new Fastify.LogController({ disableRequestLogging: true }),
  })
  const requestStartedAt = new WeakMap<object, number>()
  const errorLoggedRequests = new WeakSet<object>()
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
          .send({ error: projectOwnerError(new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')) })
    })
  }
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? '/unknown'
    const elapsed = performance.now() - (requestStartedAt.get(request) ?? performance.now())
    const fields = {
      requestId: String(request.id).slice(0, 128),
      method: request.method,
      route: sanitizeRoute(route),
      status: reply.statusCode,
      elapsedMs: Math.round(elapsed * 10) / 10,
    }
    if (reply.statusCode >= 500 && !errorLoggedRequests.has(request))
      logger.error('http.response.completed', fields)
    else logger.info('http.response.completed', fields)
  })
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined
    const status =
      Number.isInteger(statusCode) && (statusCode as number) >= 400 && (statusCode as number) < 500
        ? (statusCode as number)
        : 500
    const dto = projectOwnerError(
      new OwnerMethodError(
        status === 404 ? 'RESOURCE_NOT_FOUND' : status < 500 ? 'INVALID_PARAMS' : 'INTERNAL_ERROR',
        status >= 500,
      ),
    )
    if (status >= 500) {
      errorLoggedRequests.add(request)
      logger.error('http.request.failed', {
        requestId: String(request.id).slice(0, 128),
        method: request.method,
        route: sanitizeRoute(request.routeOptions.url ?? '/unknown'),
        status,
      })
    }
    void reply.status(status).send({ error: dto })
  })
  return app
}

function sanitizeRoute(route: string) {
  if (route.length > 200 || !route.startsWith('/')) return '/unknown'
  return route.replace(/[?#][^/]*/gu, '')
}
