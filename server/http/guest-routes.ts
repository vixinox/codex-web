import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { GuestIdentity, GuestService, GuestTurnInput } from '../guest-service.js'
import {
  apiError,
  authHeaders,
  requireSession,
  resolveEventCursor,
  safeId,
  startSseStream,
} from './common.js'
import type { AppDependencies } from './types.js'

function turnInput(body: unknown): GuestTurnInput {
  const value = body as Record<string, unknown> | undefined
  return {
    text: typeof value?.text === 'string' ? value.text : '',
    model: typeof value?.model === 'string' ? value.model : '',
    reasoningEffort: typeof value?.reasoningEffort === 'string' ? value.reasoningEffort : '',
    collaborationMode:
      typeof value?.collaborationMode === 'string' ? value.collaborationMode : undefined,
    skillHandles: Array.isArray(value?.skillHandles)
      ? value.skillHandles.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  }
}

export async function registerGuestRoutes(
  app: FastifyInstance,
  { dependencies, auth }: { dependencies: { guest: GuestService }; auth: AppDependencies['auth'] },
) {
  const service = dependencies.guest
  const requireGuest = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await requireSession(request, reply, auth)
    if (!session) return null
    const user = session.user as { kind?: string; isAnonymous?: boolean }
    if (user.kind !== 'guest' || !user.isAnonymous) {
      reply.status(403).send(apiError('GUEST_ACCESS_REQUIRED', 'Guest access required'))
      return null
    }
    const identity = await service.session(session.user.id)
    if (!identity) {
      reply.status(401).send(apiError('UNAUTHORIZED', 'Guest session expired or not found'))
      return null
    }
    return identity
  }
  const threadNotFound = (reply: FastifyReply) =>
    reply.status(404).send(apiError('GUEST_THREAD_NOT_FOUND', 'Guest thread not found'))
  const sessionBody = (identity: GuestIdentity) => ({
    guestId: identity.id,
    expiresAt: identity.expiresAt.toISOString(),
    runtime: service.runtime(),
  })

  app.post('/guest-api/session', async (request, reply) => {
    const existingSession = await auth.api.getSession({ headers: authHeaders(request) })
    const existingUser = existingSession?.user as
      | { id: string; kind?: string; isAnonymous?: boolean }
      | undefined
    if (existingUser && (existingUser.kind !== 'guest' || !existingUser.isAnonymous)) {
      return reply.status(403).send(apiError('GUEST_ACCESS_REQUIRED', 'Guest access required'))
    }
    let userId = existingUser?.id
    if (!userId) {
      const signInRes = await auth.api.signInAnonymous({
        headers: authHeaders(request),
        asResponse: true,
      })
      const setCookie = signInRes.headers.getSetCookie()
      if (setCookie.length) reply.header('set-cookie', setCookie)
      const body = (await signInRes.json()) as { user?: { id?: string } }
      userId = body.user?.id
    }
    if (!userId) {
      return reply.status(500).send(apiError('AUTH_FAILURE', 'Failed to initialize guest session'))
    }
    const started = await service.startSession(userId)
    return sessionBody(started.identity)
  })
  app.get('/guest-api/session', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    return identity ? sessionBody(identity) : undefined
  })
  app.get('/guest-api/capacity', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    return identity ? service.capacity(identity) : undefined
  })
  app.get('/guest-api/threads', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const threads = await service.listThreads(identity)
    return {
      data: threads.map((thread) => ({
        id: thread.id,
        projectId: null,
        title: thread.title,
        status: thread.status,
        updatedAt: thread.updatedAt.getTime(),
      })),
    }
  })
  app.post('/guest-api/threads', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    try {
      return reply.status(201).send(await service.createThread(identity, turnInput(request.body)))
    } catch (error) {
      return reply.status(400).send(apiError('GUEST_TURN_REJECTED', safeMessage(error)))
    }
  })
  app.get('/guest-api/threads/:guestThreadId', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const { guestThreadId } = request.params as { guestThreadId: string }
    if (!safeId(guestThreadId)) return threadNotFound(reply)
    try {
      return (await service.getThread(identity, guestThreadId)) ?? threadNotFound(reply)
    } catch {
      return reply
        .status(502)
        .send(apiError('GUEST_RUNTIME_UNAVAILABLE', 'Guest runtime is unavailable'))
    }
  })
  app.get('/guest-api/threads/:guestThreadId/status', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const { guestThreadId } = request.params as { guestThreadId: string }
    const status = safeId(guestThreadId)
      ? await service.threadStatus(identity, guestThreadId)
      : null
    return status ?? threadNotFound(reply)
  })
  app.post('/guest-api/threads/:guestThreadId/turns', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const { guestThreadId } = request.params as { guestThreadId: string }
    if (!safeId(guestThreadId)) return threadNotFound(reply)
    try {
      const started = await service.startThreadTurn(
        identity,
        guestThreadId,
        turnInput(request.body),
      )
      return started ? reply.status(201).send(started) : threadNotFound(reply)
    } catch (error) {
      return reply.status(400).send(apiError('GUEST_TURN_REJECTED', safeMessage(error)))
    }
  })
  app.post('/guest-api/threads/:guestThreadId/turns/:turnId/cancel', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const { guestThreadId, turnId } = request.params as { guestThreadId: string; turnId: string }
    return safeId(guestThreadId) &&
      safeId(turnId) &&
      (await service.cancelTurn(identity, guestThreadId, turnId))
      ? reply.status(204).send()
      : threadNotFound(reply)
  })
  app.post('/guest-api/threads/:guestThreadId/compact', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const { guestThreadId } = request.params as { guestThreadId: string }
    return safeId(guestThreadId) && (await service.compact(identity, guestThreadId))
      ? reply.status(204).send()
      : threadNotFound(reply)
  })
  app.post('/guest-api/threads/:guestThreadId/user-input/:requestId', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const { guestThreadId, requestId } = request.params as {
      guestThreadId: string
      requestId: string
    }
    const answers = (request.body as { answers?: unknown } | undefined)?.answers
    return safeId(guestThreadId) &&
      (await service.answerUserInput(identity, guestThreadId, requestId, answers))
      ? reply.status(204).send()
      : threadNotFound(reply)
  })
  app.get('/guest-api/events', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    const query = request.query as { threadId?: string; afterId?: string }
    if (!safeId(query.threadId) || !(await service.threadStatus(identity, query.threadId)))
      return threadNotFound(reply)
    const afterId = resolveEventCursor(request.headers['last-event-id'], query.afterId)
    if (afterId === null)
      return reply.status(400).send(apiError('INVALID_EVENT_CURSOR', 'Invalid event cursor'))
    await startSseStream(request, reply, (listener) =>
      service.subscribe(identity.id, query.threadId, afterId, listener),
    )
  })
  app.get('/guest-api/skills', async (request, reply) => {
    const identity = await requireGuest(request, reply)
    if (!identity) return
    try {
      return { data: await service.skills(identity) }
    } catch {
      return reply
        .status(503)
        .send(apiError('GUEST_RUNTIME_UNAVAILABLE', 'Guest skills are unavailable'))
    }
  })
}

function safeMessage(error: unknown) {
  return error instanceof Error && /^[A-Za-z0-9 .'-]{1,160}$/.test(error.message)
    ? error.message
    : 'Guest turn rejected'
}
