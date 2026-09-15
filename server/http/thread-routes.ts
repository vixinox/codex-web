import type { FastifyInstance } from 'fastify'
import { projectNativeThread } from '../codex/native-protocol.js'
import { parseRequestId } from '../codex/request-id.js'
import { createThreadDomain } from '../threads/index.js'
import type { SkillHandleStore } from '../skills.js'
import { turnInput } from '../skills.js'
import { log, safeError } from '../logger.js'
import { apiError, codexFailure, requireSession, safeId, threadAccessFailure } from './common.js'
import { parseSkillHandles, resolveSelectedSkills } from './skill-selection.js'
import type { RouteContext } from './types.js'
const reasoningEfforts = new Set(['low', 'medium', 'high', 'xhigh'])
const MAX_INITIAL_MESSAGE_LENGTH = 256_000
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
function isReplayableThreadEvent(message: { method: string; params?: Record<string, unknown> }) {
  if (message.method === 'thread/settings/updated') return true
  if (message.method === 'thread/tokenUsage/updated') return true
  if (
    message.method === 'item/tool/requestUserInput' ||
    message.method === 'webcodex/userInput/answered' ||
    message.method === 'serverRequest/resolved'
  )
    return true
  if (message.method === 'item/commandExecution/outputDelta') return true
  if (message.method !== 'item/started' && message.method !== 'item/completed') return false
  const item = message.params?.item
  return isRecord(item) && item.type === 'commandExecution'
}
export async function registerThreadRoutes(
  app: FastifyInstance,
  { config, dependencies }: RouteContext,
  skillHandles: SkillHandleStore,
) {
  const threadDomain = createThreadDomain({
    workspace: dependencies.workspace,
    codex: dependencies.codex,
  })
  app.get('/api/threads', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const query = request.query as {
      projectId?: string
      credentialId?: string
      cursor?: string
      limit?: string
      archived?: string
    }
    const rootThreadRequest = query.projectId === undefined
    const archivedRequest = query.archived === 'true'
    const project = rootThreadRequest
      ? null
      : await dependencies.workspace.getProject(session.user.id, query.projectId!)
    if (!rootThreadRequest && !project)
      return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
    const userRoot = dependencies.workspace.getUserRoot(session.user.id)
    const cwd = project?.path
    const requestedLimit = query.limit === undefined ? 30 : Number(query.limit)
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      return reply
        .status(400)
        .send(apiError('INVALID_THREAD_QUERY', 'limit must be a positive integer'))
    }
    const limit = Math.min(requestedLimit, 100)

    try {
      const [result, projects] = await Promise.all([
        (dependencies.codex.getReady
          ? dependencies.codex.getReady(session.user.id)
          : Promise.reject(new Error('CODEX_START_REQUIRED'))
        ).then((client) =>
          client.request('thread/list', {
            archived: archivedRequest,
            ...(cwd ? { cwd } : {}),
            ...(query.cursor ? { cursor: query.cursor } : {}),
            limit,
            sortDirection: 'desc',
            sortKey: 'updated_at',
          }),
        ),
        dependencies.workspace.listProjectLocations(session.user.id),
      ])
      const response = result as { data?: unknown; nextCursor?: unknown }
      const projectPaths = threadDomain.createProjectPathIndex(projects)
      const data = Array.isArray(response.data)
        ? response.data.flatMap((thread) => {
            const projectId = threadDomain.projectIdFor(thread, projectPaths)
            if (
              rootThreadRequest
                ? !threadDomain.pathIsWithin((thread as { cwd?: unknown })?.cwd, userRoot) ||
                  (!archivedRequest && projectId !== null)
                : projectId !== query.projectId
            )
              return []
            const summary = threadDomain.summarize(thread, projectId)
            return summary ? [summary] : []
          })
        : []
      return {
        data,
        nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null,
      }
    } catch (error) {
      log.error(`Thread list failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.post('/api/threads', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const body = request.body as
      | {
          projectId?: unknown
          text?: unknown
          model?: unknown
          reasoningEffort?: unknown
          collaborationMode?: unknown
          skillHandles?: unknown
        }
      | undefined
    const projectId = typeof body?.projectId === 'string' ? body.projectId : null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const model = typeof body?.model === 'string' ? body.model.trim() : ''
    const reasoningEffort = body?.reasoningEffort
    const collaborationMode = body?.collaborationMode
    const selectedHandles = parseSkillHandles(body?.skillHandles)
    if (
      collaborationMode !== undefined &&
      collaborationMode !== 'default' &&
      collaborationMode !== 'plan'
    )
      return reply
        .status(400)
        .send(apiError('INVALID_THREAD_REQUEST', 'Invalid collaboration mode'))
    if (
      (body?.projectId !== undefined && body.projectId !== null && !safeId(body.projectId)) ||
      !text ||
      text.length > MAX_INITIAL_MESSAGE_LENGTH ||
      !safeId(model) ||
      typeof reasoningEffort !== 'string' ||
      !reasoningEfforts.has(reasoningEffort) ||
      selectedHandles === null
    )
      return reply
        .status(400)
        .send(apiError('INVALID_THREAD_REQUEST', 'Invalid initial thread parameters'))
    const project = projectId
      ? await dependencies.workspace.getProject(session.user.id, projectId)
      : null
    if (projectId && !project)
      return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
    const cwd = project?.path ?? dependencies.workspace.getUserRoot(session.user.id)
    try {
      const client = await (dependencies.codex.getReady
        ? dependencies.codex.getReady(session.user.id)
        : Promise.reject(new Error('CODEX_START_REQUIRED')))
      if (
        config.requireDangerousAccessConfirmation &&
        !dependencies.codex.getStatus?.(session.user.id)?.dangerousAccessConfirmed
      )
        return reply
          .status(409)
          .send(
            apiError(
              'CODEX_DANGEROUS_ACCESS_CONFIRMATION_REQUIRED',
              'Confirm full local access before using Codex',
            ),
          )
      const selectedSkills = await resolveSelectedSkills(
        client,
        skillHandles,
        session.user.id,
        cwd,
        selectedHandles,
      )
      if (!selectedSkills)
        return reply
          .status(400)
          .send(apiError('INVALID_SKILL_SELECTION', 'Selected skills are no longer available'))
      const threadResult = await client.request('thread/start', {
        cwd,
        model,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      })
      const rawThread = (threadResult as { thread?: unknown }).thread
      const threadId =
        rawThread && typeof rawThread === 'object' ? (rawThread as { id?: unknown }).id : undefined
      if (!safeId(threadId)) throw new Error('Codex returned an invalid Thread')
      dependencies.codex.markThreadLoaded?.(session.user.id, threadId)
      const run = () =>
        client.request('turn/start', {
          threadId,
          input: turnInput(text, selectedSkills),
          effort: reasoningEffort,
          collaborationMode: {
            mode: collaborationMode ?? 'plan',
            settings: { model, reasoning_effort: reasoningEffort },
          },
        })
      const turnResult = await (dependencies.codex.enqueueTurn
        ? dependencies.codex.enqueueTurn(session.user.id, run, undefined, undefined, threadId)
        : run())
      const rawTurn = (turnResult as { turn?: unknown }).turn
      const turnId =
        rawTurn && typeof rawTurn === 'object' ? (rawTurn as { id?: unknown }).id : undefined
      if (!safeId(turnId)) throw new Error('Codex returned an invalid Turn')
      return reply.status(201).send({ threadId, turnId, projectId })
    } catch (error) {
      log.error(`Initial Thread Turn failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.get('/api/threads/:threadId', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { threadId } = request.params as { threadId: string }
    const body = request.query as { projectId?: string; credentialId?: string }
    try {
      const history = dependencies.codex.events.threadHistory
        ? await dependencies.codex.events.threadHistory(session.user.id, threadId)
        : []
      const eventCursor =
        history.at(-1)?.id ?? dependencies.codex.events.latestEventId(session.user.id, threadId)
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        projectId: body.projectId,
        includeTurns: true,
        mode: 'read',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      const thread = projectNativeThread(access.rawThread, access.cwd)
      if (!thread)
        log.error(
          `Thread read returned an invalid thread projection (threadId=${safeError(threadId)})`,
        )
      if (!thread)
        return reply
          .status(502)
          .send(apiError('CODEX_PROTOCOL_ERROR', 'Codex returned an invalid thread'))
      return {
        thread,
        eventCursor,
        historyEvents: history.filter((event) => isReplayableThreadEvent(event.message)),
      }
    } catch (error) {
      log.error(`Thread read failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.get('/api/threads/:threadId/status', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { threadId } = request.params as { threadId: string }
    const query = request.query as { projectId?: string }
    if (!safeId(threadId))
      return reply.status(400).send(apiError('INVALID_THREAD', 'Invalid thread id'))
    const rootThreadRequest = query.projectId === undefined
    const project = rootThreadRequest
      ? null
      : await dependencies.workspace.getProject(session.user.id, query.projectId!)
    if (!rootThreadRequest && !project)
      return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
    try {
      const client = await (dependencies.codex.getReady
        ? dependencies.codex.getReady(session.user.id)
        : Promise.reject(new Error('CODEX_START_REQUIRED')))
      const userRoot = dependencies.workspace.getUserRoot(session.user.id)
      let owned = await threadDomain.appearsInCwd(
        client,
        threadId,
        rootThreadRequest ? undefined : project!.path,
        false,
        rootThreadRequest ? userRoot : undefined,
      )
      if (owned && rootThreadRequest) {
        const projects = await dependencies.workspace.listProjectLocations(session.user.id)
        for (const candidate of projects) {
          if (await threadDomain.appearsInCwd(client, threadId, candidate.path)) {
            owned = false
            break
          }
        }
      }
      if (!owned) return reply.status(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'))
      const runtime = dependencies.codex.events.threadRuntimeStatus?.(
        session.user.id,
        threadId,
      ) ?? { status: 'idle' as const, activeTurnId: null }
      return {
        threadId,
        projectId: query.projectId ?? null,
        status: runtime.status,
        eventCursor: dependencies.codex.events.latestEventId(session.user.id, threadId),
        activeTurnId: runtime.activeTurnId,
      }
    } catch (error) {
      log.error(`Thread status failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.post('/api/threads/:threadId/archive', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { threadId } = request.params as { threadId: string }
    const body = request.query as { projectId?: string }
    if (!safeId(threadId))
      return reply.status(400).send(apiError('INVALID_THREAD', 'Invalid thread id'))
    try {
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        projectId: body.projectId,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      await access.client.request('thread/archive', { threadId })
      return reply.status(204).send()
    } catch (error) {
      log.error(`Thread archive failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.post('/api/threads/:threadId/unarchive', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { threadId } = request.params as { threadId: string }
    const query = request.query as { projectId?: string }
    if (!safeId(threadId))
      return reply.status(400).send(apiError('INVALID_THREAD', 'Invalid thread id'))
    try {
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        projectId: query.projectId,
        archived: true,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      await access.client.request('thread/unarchive', { threadId })
      return reply.status(204).send()
    } catch (error) {
      log.error(`Thread unarchive failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.delete('/api/threads/:threadId', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { threadId } = request.params as { threadId: string }
    const query = request.query as { projectId?: string }
    if (!safeId(threadId))
      return reply.status(400).send(apiError('INVALID_THREAD', 'Invalid thread id'))
    try {
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        projectId: query.projectId,
        archived: true,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      await access.client.request('thread/delete', { threadId })
      return reply.status(204).send()
    } catch (error) {
      log.error(`Thread delete failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.delete('/api/threads', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const query = request.query as { archived?: string }
    if (query.archived !== 'true')
      return reply.status(400).send(apiError('INVALID_THREAD_QUERY', 'archived=true is required'))
    try {
      const client = await dependencies.codex.getReady!(session.user.id)
      const userRoot = dependencies.workspace.getUserRoot(session.user.id)
      let cursor: string | undefined
      do {
        const result = (await client.request('thread/list', {
          archived: true,
          ...(cursor ? { cursor } : {}),
          limit: 100,
          sortDirection: 'desc',
          sortKey: 'updated_at',
        })) as { data?: unknown; nextCursor?: unknown }
        for (const thread of Array.isArray(result.data) ? result.data : []) {
          const id = (thread as { id?: unknown }).id
          const cwd = (thread as { cwd?: unknown }).cwd
          if (typeof id === 'string' && threadDomain.pathIsWithin(cwd, userRoot))
            await client.request('thread/delete', { threadId: id })
        }
        cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
      } while (cursor)
      return reply.status(204).send()
    } catch (error) {
      log.error(`Archived thread delete failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.post('/api/threads/:threadId/turns', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const { threadId } = request.params as { threadId: string }
      const body = (request.body ?? {}) as {
        projectId?: unknown
        text?: unknown
        model?: unknown
        reasoningEffort?: unknown
        collaborationMode?: unknown
        skillHandles?: unknown
      }
      const projectId = typeof body.projectId === 'string' ? body.projectId : null
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      const model = typeof body.model === 'string' ? body.model.trim() : ''
      const reasoningEffort = body.reasoningEffort
      const collaborationMode = body.collaborationMode
      const selectedHandles = parseSkillHandles(body.skillHandles)
      if (
        collaborationMode !== undefined &&
        collaborationMode !== 'default' &&
        collaborationMode !== 'plan'
      )
        return reply
          .status(400)
          .send(apiError('INVALID_TURN_REQUEST', 'Invalid collaboration mode'))
      if (
        !safeId(threadId) ||
        (body.projectId !== null && !safeId(body.projectId)) ||
        !text ||
        text.length > MAX_INITIAL_MESSAGE_LENGTH ||
        !safeId(model) ||
        typeof reasoningEffort !== 'string' ||
        !reasoningEfforts.has(reasoningEffort) ||
        selectedHandles === null
      )
        return reply.status(400).send(apiError('INVALID_TURN_REQUEST', 'Invalid turn parameters'))
      if (
        config.requireDangerousAccessConfirmation &&
        !dependencies.codex.getStatus?.(session.user.id)?.dangerousAccessConfirmed
      )
        return reply
          .status(409)
          .send(
            apiError(
              'CODEX_DANGEROUS_ACCESS_CONFIRMATION_REQUIRED',
              'Confirm full local access before using Codex',
            ),
          )
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        projectId: projectId ?? undefined,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      const client = access.client
      const project = access.scope === 'project' ? { path: access.cwd } : null
      const userRoot = dependencies.workspace.getUserRoot(session.user.id)
      await dependencies.codex.ensureThread?.(session.user.id, threadId)
      const selectedSkills = await resolveSelectedSkills(
        client,
        skillHandles,
        session.user.id,
        project?.path ?? userRoot,
        selectedHandles,
      )
      if (!selectedSkills)
        return reply
          .status(400)
          .send(apiError('INVALID_SKILL_SELECTION', 'Selected skills are no longer available'))
      const run = () =>
        client.request('turn/start', {
          threadId,
          input: turnInput(text, selectedSkills),
          model,
          effort: reasoningEffort,
          collaborationMode: {
            mode: collaborationMode ?? 'plan',
            settings: { model, reasoning_effort: reasoningEffort },
          },
        })
      const result = await (dependencies.codex.enqueueTurn
        ? dependencies.codex.enqueueTurn(session.user.id, run, undefined, undefined, threadId)
        : run())
      const rawTurn = (result as { turn?: unknown }).turn
      const turnId =
        rawTurn && typeof rawTurn === 'object' ? (rawTurn as { id?: unknown }).id : undefined
      if (!safeId(turnId)) throw new Error('Codex returned an invalid Turn')
      return reply.status(201).send({ turnId })
    } catch (error) {
      log.error(`Turn start failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.post('/api/threads/:threadId/user-input/:requestId', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const { threadId, requestId: requestIdText } = request.params as {
        threadId: string
        requestId: string
      }
      const body = (request.body ?? {}) as { answers?: unknown }
      if (!safeId(threadId) || !isRecord(body.answers))
        return reply.status(400).send(apiError('INVALID_USER_INPUT', 'Invalid user input'))
      for (const value of Object.values(body.answers)) {
        if (
          !isRecord(value) ||
          !Array.isArray(value.answers) ||
          !value.answers.every((answer) => typeof answer === 'string')
        )
          return reply.status(400).send(apiError('INVALID_USER_INPUT', 'Invalid user input'))
      }
      const parsedRequestId = parseRequestId(requestIdText)
      if (
        (typeof parsedRequestId !== 'number' && typeof parsedRequestId !== 'string') ||
        !dependencies.codex.respondToServerRequest
      )
        throw new Error('Invalid user input request id')
      const resolvedRequestId =
        dependencies.codex.respondToServerRequest(session.user.id, threadId, parsedRequestId, {
          answers: body.answers,
        }) ?? parsedRequestId
      await dependencies.codex.events.publish?.(session.user.id, {
        method: 'webcodex/userInput/answered',
        params: {
          threadId,
          requestId: resolvedRequestId,
          answers: body.answers,
        },
      })
      return reply.status(204).send()
    } catch {
      return reply.status(502).send(apiError('CODEX_UNAVAILABLE', 'Codex App Server unavailable'))
    }
  })

  app.post('/api/threads/:threadId/compact', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const { threadId } = request.params as { threadId: string }
      if (!safeId(threadId))
        return reply.status(400).send(apiError('INVALID_THREAD', 'Invalid thread parameters'))
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      await access.client.request('thread/compact/start', { threadId })
      return reply.status(204).send()
    } catch (error) {
      log.error(`Thread compaction failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })

  app.post('/api/threads/:threadId/turns/:turnId/cancel', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const { threadId, turnId } = request.params as {
        threadId: string
        turnId: string
      }
      if (!safeId(threadId) || !safeId(turnId))
        return reply
          .status(400)
          .send(apiError('INVALID_PROJECT', 'Invalid cancellation parameters'))
      if (dependencies.codex.cancelQueuedTurn?.(session.user.id, turnId))
        return reply.status(204).send()
      const access = await threadDomain.access({
        userId: session.user.id,
        threadId,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') return threadAccessFailure(reply, access)
      const result = await access.client.request('turn/interrupt', {
        threadId,
        turnId,
      })
      return result
    } catch (error) {
      log.error(`Turn cancellation failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })
}
