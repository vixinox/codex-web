import type { FastifyInstance } from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import { requireSession } from './common.js'

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

  app.post('/api/auth/owner-security/setup', async (request, reply) => {
    if (!isTrustedLocalRequest(request, config.trustedOrigins))
      return reply.status(403).send(apiError('LOCAL_TRANSPORT_REQUIRED', 'Local Owner required'))
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return reply
    const body = isRecord(request.body) ? request.body : {}
    if (typeof body.password !== 'string' || body.password.length === 0)
      return reply.status(400).send(apiError('INVALID_PARAMS', 'Owner password is required'))
    try {
      const enable = (
        dependencies.auth.api as unknown as {
          enableTwoFactor: (input: unknown) => Promise<unknown>
        }
      ).enableTwoFactor
      const result = await enable({
        body: { password: body.password, method: 'totp', issuer: 'Codex Web' },
        headers: fromNodeHeaders(request.headers),
      })
      if (!isRecord(result)) throw new Error('TOTP setup failed')
      return {
        ...(typeof result.totpURI === 'string' ? { totpURI: result.totpURI } : {}),
        ...(Array.isArray(result.backupCodes) ? { backupCodes: result.backupCodes } : {}),
      }
    } catch {
      return reply.status(401).send(apiError('AUTH_FAILURE', 'TOTP setup failed'))
    }
  })

  app.post('/api/auth/owner-security/verify', async (request, reply) => {
    if (!isTrustedLocalRequest(request, config.trustedOrigins))
      return reply.status(403).send(apiError('LOCAL_TRANSPORT_REQUIRED', 'Local Owner required'))
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return reply
    const body = isRecord(request.body) ? request.body : {}
    if (typeof body.code !== 'string')
      return reply.status(400).send(apiError('INVALID_PARAMS', 'A TOTP code is required'))
    try {
      const verify = (
        dependencies.auth.api as unknown as { verifyTOTP: (input: unknown) => Promise<Response> }
      ).verifyTOTP
      const response = await verify({
        body: { code: body.code },
        headers: fromNodeHeaders(request.headers),
        asResponse: true,
      })
      reply.status(response.status)
      const setCookies = response.headers.getSetCookie()
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') reply.header(name, value)
      })
      if (setCookies.length > 0) reply.header('set-cookie', setCookies)
      return reply.send(Buffer.from(await response.arrayBuffer()))
    } catch {
      return reply.status(401).send(apiError('AUTH_FAILURE', 'TOTP verification failed'))
    }
  })

  app.post('/api/auth/owner-security/complete', async (request, reply) => {
    if (!isTrustedLocalRequest(request, config.trustedOrigins))
      return reply.status(403).send(apiError('LOCAL_TRANSPORT_REQUIRED', 'Local Owner required'))
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return reply
    if (session.user.twoFactorEnabled !== true)
      return reply.status(403).send(apiError('AUTH_FAILURE', 'TOTP setup is incomplete'))
    try {
      const codes = await dependencies.auth.api.viewBackupCodes({
        body: { userId: session.user.id },
      })
      if (
        !isRecord(codes) ||
        !Array.isArray(codes.backupCodes) ||
        codes.backupCodes.length === 0 ||
        !codes.backupCodes.every((code) => typeof code === 'string')
      )
        return reply.status(403).send(apiError('AUTH_FAILURE', 'Recovery setup is incomplete'))
    } catch {
      return reply.status(403).send(apiError('AUTH_FAILURE', 'Recovery setup is incomplete'))
    }
    const completed = await dependencies.workspace.acknowledgeOwnerRecoveryCodes(session.user.id)
    if (!completed)
      return reply.status(403).send(apiError('AUTH_FAILURE', 'Security setup is incomplete'))
    return { initialized: true }
  })

  if (dependencies.auth.handler) {
    app.get('/api/auth/get-session', async (request, reply) => {
      return forwardAuthRequest(
        request,
        reply,
        dependencies.auth.handler,
        config.authUrl,
        async (body) => {
          if (!isRecord(body) || !isRecord(body.user) || typeof body.user.id !== 'string')
            return body
          const initialized = await dependencies.workspace.isOwnerSecurityInitialized(body.user.id)
          if (initialized) return body
          return { ...body, user: { ...body.user, twoFactorEnabled: false } }
        },
      )
    })
  }

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
        return await forwardAuthRequest(request, reply, dependencies.auth.handler, config.authUrl)
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

function isTrustedLocalRequest(request: FastifyRequest, trustedOrigins: readonly string[]) {
  const origin = request.headers.origin
  return (
    request.headers['x-codex-web-remote'] !== '1' &&
    typeof origin === 'string' &&
    trustedOrigins.includes(origin)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function forwardAuthRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  authHandler: (request: Request) => Promise<Response>,
  authUrl: string,
  transformBody?: (body: unknown) => Promise<unknown>,
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
  const transformedBody = transformBody
    ? await response
        .clone()
        .json()
        .then(transformBody)
        .catch(() => undefined)
    : undefined
  reply.status(response.status)
  const setCookies = response.headers.getSetCookie()
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') reply.header(name, value)
  })
  if (setCookies.length > 0) reply.header('set-cookie', setCookies)
  return reply.send(
    transformedBody === undefined ? Buffer.from(await response.arrayBuffer()) : transformedBody,
  )
}
