import type { FastifyInstance } from 'fastify'

import { apiError, requireSession, safeId } from './common.js'
import type { RouteContext } from './types.js'

export async function registerCredentialRoutes(
  app: FastifyInstance,
  { dependencies }: RouteContext,
) {
  app.get('/api/credentials', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    return {
      credentials: await dependencies.workspace.listCredentials(session.user.id),
      currentCredentialId: await dependencies.workspace.getCurrentCredentialId(session.user.id),
    }
  })

  app.put('/api/credentials/current', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const body = request.body as { credentialId?: unknown } | undefined
    if (!safeId(body?.credentialId))
      return reply.status(400).send(apiError('INVALID_CREDENTIAL', 'Invalid credentialId'))
    const credentialId = body.credentialId
    if (!(await dependencies.workspace.setCurrentCredentialId(session.user.id, credentialId)))
      return reply.status(404).send(apiError('CREDENTIAL_NOT_FOUND', 'Credential not found'))
    return { currentCredentialId: credentialId }
  })

  app.post('/api/credentials', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const body = request.body as
        | { provider?: unknown; baseUrl?: unknown; apiKey?: unknown }
        | undefined
      if (
        typeof body?.provider !== 'string' ||
        typeof body.baseUrl !== 'string' ||
        typeof body.apiKey !== 'string'
      )
        throw new Error('provider, baseUrl and apiKey are required')
      const saved = await dependencies.workspace.saveCredential(session.user.id, {
        provider: body.provider,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
      })
      dependencies.codex.markCredentialPending?.(session.user.id, saved.id)
      return reply.status(201).send(saved)
    } catch (error) {
      return reply
        .status(400)
        .send(
          apiError(
            'INVALID_CREDENTIAL',
            error instanceof Error ? error.message : 'Invalid credential',
          ),
        )
    }
  })

  app.post('/api/credentials/:id/test', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { id } = request.params as { id: string }
    if (!(await dependencies.workspace.getCredential(session.user.id, id)))
      return reply.status(404).send(apiError('CREDENTIAL_NOT_FOUND', 'Credential not found'))
    try {
      await dependencies.workspace.testCredential(session.user.id, id)
      return { ok: true }
    } catch {
      return reply
        .status(502)
        .send(apiError('CREDENTIAL_TEST_FAILED', 'Credential connection test failed'))
    }
  })

  app.delete('/api/credentials/:id', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { id } = request.params as { id: string }
    if (!(await dependencies.workspace.deleteCredential(session.user.id, id)))
      return reply.status(404).send(apiError('CREDENTIAL_NOT_FOUND', 'Credential not found'))
    await dependencies.codex.stop?.(session.user.id)
    return reply.status(204).send()
  })
}
