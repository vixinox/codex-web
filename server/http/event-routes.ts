import type { FastifyInstance } from 'fastify'
import { createThreadDomain } from '../threads/index.js'
import { log, safeError } from '../logger.js'
import {
  apiError,
  codexFailure,
  requireSession,
  resolveEventCursor,
  safeId,
  startSseStream,
} from './common.js'
import type { RouteContext } from './types.js'
export async function registerEventRoutes(app: FastifyInstance, { dependencies }: RouteContext) {
  const threadDomain = createThreadDomain({
    workspace: dependencies.workspace,
    codex: dependencies.codex,
  })
  app.get('/api/events', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const query = request.query as { threadId?: string; scope?: string; afterId?: string }
    if (query.scope !== 'workspace' && !safeId(query.threadId))
      return reply
        .status(400)
        .send(apiError('INVALID_THREAD_QUERY', 'threadId or scope=workspace is required'))
    const afterId = resolveEventCursor(request.headers['last-event-id'], query.afterId)
    if (afterId === null)
      return reply.status(400).send(apiError('INVALID_EVENT_CURSOR', 'Invalid event cursor'))
    try {
      const client = await (dependencies.codex.getReady
        ? dependencies.codex.getReady(session.user.id)
        : Promise.reject(new Error('CODEX_START_REQUIRED')))
      const raw = (
        query.scope === 'workspace'
          ? null
          : await client.request('thread/read', {
              threadId: query.threadId,
              includeTurns: false,
            })
      ) as { thread?: unknown } | null
      const thread = raw?.thread
      const cwd =
        thread && typeof thread === 'object' ? (thread as { cwd?: unknown }).cwd : undefined
      const userRoot = dependencies.workspace.getUserRoot(session.user.id)
      const projects = await dependencies.workspace.listProjectLocations(session.user.id)
      const projectId = threadDomain.projectIdFor(
        thread,
        threadDomain.createProjectPathIndex(projects),
      )
      if (
        query.scope !== 'workspace' &&
        (!threadDomain.pathIsWithin(cwd, userRoot) ||
          (typeof cwd === 'string' &&
            projectId === null &&
            projects.some((project) => threadDomain.pathIsWithin(cwd, project.path))))
      )
        return reply.status(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'))
    } catch (error) {
      log.error(`Event stream authorization failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
    await startSseStream(request, reply, (listener) =>
      dependencies.codex.events.subscribe(
        session.user.id,
        query.scope === 'workspace' ? undefined : query.threadId,
        afterId,
        listener,
      ),
    )
  })
}
