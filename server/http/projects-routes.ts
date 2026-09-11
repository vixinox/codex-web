import type { FastifyInstance } from 'fastify'

import { apiError, requireSession } from './common.js'
import type { RouteContext } from './types.js'
import { ProjectConflictError } from '../workspace.js'

export async function registerProjectRoutes(app: FastifyInstance, { dependencies }: RouteContext) {
  app.get('/api/projects', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    return { projects: await dependencies.workspace.listProjects(session.user.id) }
  })

  app.post('/api/projects', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    try {
      const body = request.body as { name?: unknown } | undefined
      if (typeof body?.name !== 'string') throw new Error('name is required')
      return reply
        .status(201)
        .send(await dependencies.workspace.createProject(session.user.id, body.name))
    } catch (error) {
      if (error instanceof ProjectConflictError)
        return reply.status(409).send(apiError('PROJECT_EXISTS', error.message))
      return reply.status(400).send(apiError('INVALID_PROJECT', 'Invalid project name'))
    }
  })

  app.patch('/api/projects/:id', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { id } = request.params as { id: string }
    try {
      const body = request.body as { name?: unknown } | undefined
      if (typeof body?.name !== 'string') throw new Error('name is required')
      const updated = await dependencies.workspace.renameProject(session.user.id, id, body.name)
      if (!updated)
        return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
      return updated
    } catch (error) {
      if (error instanceof ProjectConflictError)
        return reply.status(409).send(apiError('PROJECT_EXISTS', error.message))
      return reply.status(400).send(apiError('INVALID_PROJECT', 'Invalid project name'))
    }
  })

  app.delete('/api/projects/:id', async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return
    const { id } = request.params as { id: string }
    const deleted = await dependencies.workspace.deleteProject(session.user.id, id)
    if (!deleted) return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
    return reply.status(204).send()
  })
}
