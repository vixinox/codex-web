import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { apiError, codexFailure, requireSession, safeId } from './common.js'
import type { RouteContext } from './types.js'

const DEFAULT_MODEL_CONTEXT_WINDOW = 256_000
const contextWindowFromConfig = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

export async function registerConfigurationRoutes(
  app: FastifyInstance,
  { config, dependencies }: RouteContext,
) {
  app.get('/api/codex/status', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    return {
      ...(dependencies.codex.getStatus?.(session.user.id) ?? {
        status: 'stopped',
        projectId: null,
        activeCredentialId: null,
        pendingCredentialId: null,
        restartRequired: false,
        activeTurns: 0,
        error: null,
      }),
      currentCredentialId: await dependencies.workspace.getCurrentCredentialId(session.user.id),
    }
  })

  app.get('/api/configuration/context-window', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const client = await (dependencies.codex.getReady
        ? dependencies.codex.getReady(session.user.id)
        : Promise.reject(new Error('CODEX_START_REQUIRED')))
      const result = await client.request('config/read', { includeLayers: false })
      const configured =
        result && typeof result === 'object' && 'config' in result
          ? contextWindowFromConfig(
              (result.config as Record<string, unknown>)?.model_context_window,
            )
          : null
      return {
        modelContextWindow: configured ?? DEFAULT_MODEL_CONTEXT_WINDOW,
        source: configured ? 'configured' : 'default',
      }
    } catch (error) {
      return codexFailure(reply, error)
    }
  })

  app.put('/api/configuration/context-window', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const value = (request.body as { modelContextWindow?: unknown } | undefined)?.modelContextWindow
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
      return reply
        .status(400)
        .send(apiError('INVALID_CONTEXT_WINDOW', 'Context window must be a positive safe integer'))
    try {
      const client = await (dependencies.codex.getReady
        ? dependencies.codex.getReady(session.user.id)
        : Promise.reject(new Error('CODEX_START_REQUIRED')))
      await client.request('config/value/write', {
        keyPath: 'model_context_window',
        value,
        mergeStrategy: 'replace',
      })
      return { modelContextWindow: value, source: 'configured' }
    } catch (error) {
      return codexFailure(reply, error)
    }
  })

  async function lifecycle(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: 'start' | 'restart',
  ) {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const body = (request.body ?? {}) as {
      credentialId?: unknown
      confirmDangerousAccess?: unknown
    }
    if (config.requireDangerousAccessConfirmation && body.confirmDangerousAccess !== true)
      return reply
        .status(428)
        .send(
          apiError(
            'CODEX_DANGEROUS_ACCESS_CONFIRMATION_REQUIRED',
            'Explicit confirmation is required before enabling full local access',
          ),
        )
    if (body.credentialId !== undefined && !safeId(body.credentialId))
      return reply.status(400).send(apiError('INVALID_CREDENTIAL', 'Invalid credentialId'))
    const credentialId =
      (body.credentialId) ??
      (await dependencies.workspace.getCurrentCredentialId(session.user.id))
    if (!credentialId)
      return reply
        .status(409)
        .send(apiError('CODEX_PROFILE_REQUIRED', 'Select a Codex credential in Settings first'))
    if (!(await dependencies.workspace.getCredential(session.user.id, credentialId)))
      return reply.status(404).send(apiError('INVALID_CREDENTIAL', 'Credential not found'))
    try {
      const method = operation === 'restart' ? dependencies.codex.restart : dependencies.codex.start
      if (!method)
        return reply
          .status(501)
          .send(apiError('CODEX_UNAVAILABLE', 'Codex lifecycle control is unavailable'))
      await method.call(dependencies.codex, session.user.id, '', credentialId)
      dependencies.codex.markDangerousAccessConfirmed?.(session.user.id)
      await dependencies.workspace.setCurrentCredentialId(session.user.id, credentialId)
      return {
        ...(dependencies.codex.getStatus?.(session.user.id) ?? {
          status: 'ready',
          projectId: null,
          activeCredentialId: credentialId,
          pendingCredentialId: null,
          restartRequired: false,
          activeTurns: 0,
          error: null,
          dangerousAccessConfirmed: true,
        }),
        currentCredentialId: credentialId,
      }
    } catch (error) {
      return codexFailure(reply, error)
    }
  }

  app.post('/api/codex/start', (request, reply) => lifecycle(request, reply, 'start'))
  app.post('/api/codex/restart', (request, reply) => lifecycle(request, reply, 'restart'))
}
