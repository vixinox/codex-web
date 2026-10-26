import type { FastifyInstance } from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'

import { apiError } from './common.js'
import type { RouteContext } from './types.js'

export async function registerAuthRoutes(
  app: FastifyInstance,
  { config, dependencies }: RouteContext,
) {
  let signupQueue: Promise<void> = Promise.resolve()

  app.get('/api/auth/bootstrap', async () => ({
    ownerExists: (await dependencies.workspace.hasOwner?.()) ?? false,
  }))

  app.all('/api/auth/*', async (request, reply) => {
    if (request.method === 'POST' && request.url.split('?', 1)[0] === '/api/auth/sign-up/email') {
      const operation = signupQueue.then(async () => {
        const origin = request.headers.origin
        if (
          request.headers['x-codex-web-remote'] === '1' ||
          typeof origin !== 'string' ||
          !config.trustedOrigins.includes(origin)
        )
          return reply
            .status(403)
            .send(
              apiError('LOCAL_TRANSPORT_REQUIRED', 'Owner registration requires a local origin'),
            )
        if ((await dependencies.workspace.hasOwner?.()) ?? false)
          return reply
            .status(409)
            .send(apiError('OWNER_ALREADY_EXISTS', 'The Owner account is already initialized'))
        await forwardAuthRequest(request, reply, dependencies.auth.handler, config.authUrl)
      })
      signupQueue = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    }

    return forwardAuthRequest(request, reply, dependencies.auth.handler, config.authUrl)
  })
}

async function forwardAuthRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  authHandler: (request: Request) => Promise<Response>,
  authUrl: string,
) {
  const headers = fromNodeHeaders(request.headers)
  headers.set('x-codex-web-client-ip', request.ip)
  const body =
    request.body === undefined
      ? undefined
      : typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body)
  const authRequest = new Request(new URL(request.url, authUrl), {
    method: request.method,
    headers,
    ...(body === undefined || ['GET', 'HEAD'].includes(request.method) ? {} : { body }),
  })
  const response = await authHandler(authRequest)
  reply.status(response.status)
  const setCookies = response.headers.getSetCookie()
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') reply.header(name, value)
  })
  if (setCookies.length > 0) reply.header('set-cookie', setCookies)
  return reply.send(Buffer.from(await response.arrayBuffer()))
}
