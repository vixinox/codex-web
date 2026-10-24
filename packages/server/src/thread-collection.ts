import type { WorkspaceService } from './workspace.js'
import {
  createProjectPathIndex,
  projectIdForThread,
  sanitizeThreadSummary,
} from './thread-contract.js'
import { pathIsWithin, type ThreadClient } from './thread-ownership.js'

export type ThreadCollectionRequest = {
  userId: string
  projectId?: string
  cursor?: string
  limit: number
  archived: boolean
}

export type ThreadCollectionResult =
  | { kind: 'ok'; data: unknown[]; nextCursor: string | null }
  | { kind: 'project_not_found' }
  | { kind: 'codex_start_required' }
  | { kind: 'codex_unavailable'; error: unknown }

export type ThreadCollectionDependencies = {
  workspace: Pick<WorkspaceService, 'getProject' | 'listProjectLocations' | 'getUserRoot'>
  codex: { getReady?: (userId: string) => Promise<ThreadClient> }
}

export function createThreadCollection(dependencies: ThreadCollectionDependencies) {
  return {
    list: async (request: ThreadCollectionRequest): Promise<ThreadCollectionResult> => {
      if (!dependencies.codex.getReady) return { kind: 'codex_start_required' }
      const project = request.projectId
        ? await dependencies.workspace.getProject(request.userId, request.projectId)
        : null
      if (request.projectId && !project) return { kind: 'project_not_found' }
      try {
        const client = await dependencies.codex.getReady(request.userId)
        const [result, projects] = await Promise.all([
          client.request('thread/list', {
            archived: request.archived,
            ...(project?.path ? { cwd: project.path } : {}),
            ...(request.cursor ? { cursor: request.cursor } : {}),
            limit: request.limit,
            sortDirection: 'desc',
            sortKey: 'updated_at',
          }),
          dependencies.workspace.listProjectLocations(request.userId),
        ])
        const response = result as { data?: unknown; nextCursor?: unknown }
        const projectPaths = createProjectPathIndex(projects)
        const userRoot = dependencies.workspace.getUserRoot(request.userId)
        const data = Array.isArray(response.data)
          ? response.data.flatMap((thread) => {
              const projectId = projectIdForThread(thread, projectPaths)
              const cwd =
                thread && typeof thread === 'object' ? (thread as { cwd?: unknown }).cwd : undefined
              const allowed = request.projectId
                ? projectId === request.projectId
                : pathIsWithin(cwd, userRoot) && (request.archived || projectId === null)
              if (!allowed) return []
              const summary = sanitizeThreadSummary(thread, projectId)
              return summary ? [summary] : []
            })
          : []
        return {
          kind: 'ok',
          data,
          nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null,
        }
      } catch (error) {
        return { kind: 'codex_unavailable', error }
      }
    },
  }
}
