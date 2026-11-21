import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
export type ProjectSummary = { id: string; name: string }
import type { ThreadSummary } from '@/lib/bridge/interfaces/thread'
import type { RuntimeCapabilityModel } from '@/app/chat/composer/model/composer-capabilities'

export type WorkspaceSkill = {
  path: string
  name: string
  displayName: string
  description: string
  scope: 'system' | 'user' | 'repo' | 'admin'
}

export const ownerWorkspace = {
  projects: {
    list: async (signal?: AbortSignal): Promise<readonly ProjectSummary[]> => {
      const result = await getOwnerBridge().request<unknown>('projects.list', undefined, { signal })
      if (Array.isArray(result)) return result as ProjectSummary[]
      if (isRecord(result) && Array.isArray(result.projects))
        return result.projects as ProjectSummary[]
      throw new Error('Project list response is invalid.')
    },
    create: (name: string) =>
      getOwnerBridge().request<ProjectSummary>('projects.create', { name }, { mutation: true }),
    rename: (projectId: string, name: string) =>
      getOwnerBridge().request<ProjectSummary>(
        'projects.rename',
        { projectId, name },
        { mutation: true },
      ),
    delete: async (projectId: string) => {
      await getOwnerBridge().request('projects.delete', { projectId }, { mutation: true })
    },
  },
  threads: {
    list: async (projectId: string | null, signal?: AbortSignal, archived = false) => {
      const threads: ThreadSummary[] = []
      let cursor: string | undefined
      const seenCursors = new Set<string>()
      do {
        const result = await getOwnerBridge().request<unknown>(
          'threads.list',
          { projectId, archived, limit: 100, ...(cursor ? { cursor } : {}) },
          { signal },
        )
        if (Array.isArray(result)) {
          threads.push(...(result as ThreadSummary[]))
          break
        }
        if (!isRecord(result) || !Array.isArray(result.data))
          throw new Error('Thread list response is invalid.')
        threads.push(...(result.data as ThreadSummary[]))
        cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
        if (cursor && seenCursors.has(cursor)) throw new Error('Thread list cursor repeated.')
        if (cursor) seenCursors.add(cursor)
      } while (cursor)
      return threads
    },
    archive: async (projectId: string | null, threadId: string) => {
      await getOwnerBridge().request(
        'threads.archive',
        { ...(projectId ? { projectId } : {}), threadId },
        { mutation: true },
      )
    },
    delete: async (projectId: string | null, threadId: string) => {
      await getOwnerBridge().request(
        'threads.delete',
        { ...(projectId ? { projectId } : {}), threadId },
        { mutation: true },
      )
    },
    unarchive: async (projectId: string | null, threadId: string) => {
      await getOwnerBridge().request(
        'threads.unarchive',
        { ...(projectId ? { projectId } : {}), threadId },
        { mutation: true },
      )
    },
    deleteAllArchived: async () => {
      await getOwnerBridge().request('threads.deleteAll', undefined, { mutation: true })
    },
  },
  skills: (projectId: string | null, signal?: AbortSignal) =>
    getOwnerBridge().request<readonly WorkspaceSkill[]>('skills.list', { projectId }, { signal }),
  capabilities: (signal?: AbortSignal) =>
    getOwnerBridge().request<{ models: readonly RuntimeCapabilityModel[] }>(
      'capabilities.list',
      undefined,
      { signal },
    ),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
