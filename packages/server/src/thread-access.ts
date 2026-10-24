import type { WorkspaceService } from './workspace.js'
import {
  createProjectPathIndex,
  projectIdForThread,
  type ProjectLocation,
} from './thread-contract.js'
import { projectIsAllowed, threadAppearsInCwd, type ThreadClient } from './thread-ownership.js'

export type ThreadAccessRequest = {
  userId: string
  threadId: string
  projectId?: string
  archived?: boolean
  includeTurns?: boolean
  mode: 'read' | 'mutation'
}

export type ThreadAccessResult =
  | {
      kind: 'owned'
      client: ThreadClient
      rawThread: unknown
      projectId: string | null
      cwd: string
      scope: 'project' | 'user-root'
    }
  | { kind: 'not_found' }
  | { kind: 'project_not_found' }
  | { kind: 'codex_start_required' }
  | { kind: 'codex_unavailable'; error: unknown }
  | { kind: 'invalid_projection' }

export type ThreadAccessDependencies = {
  workspace: Pick<WorkspaceService, 'getProject' | 'listProjectLocations' | 'getUserRoot'>
  codex: {
    getReady?: (userId: string) => Promise<ThreadClient>
  }
}

function threadCwd(value: unknown) {
  return value !== null &&
    typeof value === 'object' &&
    typeof (value as { cwd?: unknown }).cwd === 'string'
    ? (value as { cwd: string }).cwd
    : null
}

export function createThreadAccess(dependencies: ThreadAccessDependencies) {
  return {
    access: async (request: ThreadAccessRequest): Promise<ThreadAccessResult> => {
      if (!dependencies.codex.getReady) return { kind: 'codex_start_required' }
      let client: ThreadClient
      try {
        client = await dependencies.codex.getReady(request.userId)
      } catch (error) {
        if (error instanceof Error && error.message === 'CODEX_START_REQUIRED')
          return { kind: 'codex_start_required' }
        return { kind: 'codex_unavailable', error }
      }

      const project =
        request.projectId === undefined
          ? null
          : await dependencies.workspace.getProject(request.userId, request.projectId)
      if (request.projectId !== undefined && !project) return { kind: 'project_not_found' }

      try {
        const projects = (await dependencies.workspace.listProjectLocations(
          request.userId,
        )) as ProjectLocation[]
        const shouldRead = request.mode === 'read' || request.projectId === undefined
        const rawThread = shouldRead
          ? (
              (await client.request('thread/read', {
                threadId: request.threadId,
                includeTurns: request.includeTurns ?? false,
              })) as { thread?: unknown }
            ).thread
          : undefined
        const actualProjectId = shouldRead
          ? projectIdForThread(rawThread, createProjectPathIndex(projects))
          : (request.projectId ?? null)
        const userRoot = dependencies.workspace.getUserRoot(request.userId)
        const isRootScope = request.projectId === undefined
        const cwd = shouldRead ? threadCwd(rawThread) : (project?.path ?? null)
        if (!cwd) return { kind: 'invalid_projection' }
        const ownedByScope = projectIsAllowed(
          actualProjectId,
          request.projectId,
          cwd,
          project ?? undefined,
          userRoot,
        )
        if (!ownedByScope) return { kind: 'not_found' }

        if (request.mode === 'mutation' || isRootScope) {
          const appears = await threadAppearsInCwd(
            client,
            request.threadId,
            project?.path,
            request.archived ?? false,
            isRootScope ? userRoot : undefined,
          )
          if (!appears) return { kind: 'not_found' }
        }
        return {
          kind: 'owned',
          client,
          rawThread,
          projectId: actualProjectId,
          cwd,
          scope: isRootScope ? 'user-root' : 'project',
        }
      } catch (error) {
        return { kind: 'codex_unavailable', error }
      }
    },
  }
}
