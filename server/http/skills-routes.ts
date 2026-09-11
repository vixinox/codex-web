import type { FastifyInstance } from 'fastify'
import type { SkillHandleStore} from '../skills.js';
import { skillsForCwd } from '../skills.js'
import { apiError, codexFailure, requireSession, safeId } from './common.js'
import type { RouteContext } from './types.js'
import { log, safeError } from '../logger.js'
export async function registerSkillRoutes(
  app: FastifyInstance,
  { dependencies }: RouteContext,
  skillHandles: SkillHandleStore,
) {
  app.get('/api/skills', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const query = request.query as { projectId?: unknown }
    const projectId = typeof query.projectId === 'string' ? query.projectId : null
    if (query.projectId !== undefined && !safeId(projectId))
      return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
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
      const result = await client.request('skills/list', { cwds: [cwd] })
      return reply.send({
        data: skillsForCwd(result, cwd).map((skill) =>
          skillHandles.issue(session.user.id, cwd, skill),
        ),
      })
    } catch (error) {
      log.error(`Skill list failed: ${safeError(error)}`)
      return codexFailure(reply, error)
    }
  })
}
