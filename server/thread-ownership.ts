import path from 'node:path'

import type { ProjectLocation } from './thread-contract.js'

export type ThreadClient = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export function pathIsWithin(value: unknown, root: string) {
  if (typeof value !== 'string') return false
  const resolved = path.resolve(value)
  const base = path.resolve(root)
  const relative = path.relative(base, resolved)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export async function threadAppearsInCwd(
  client: ThreadClient,
  threadId: string,
  cwd?: string,
  archived = false,
  allowedRoot?: string,
) {
  let cursor: string | undefined
  do {
    const result = (await client.request('thread/list', {
      archived,
      ...(cwd ? { cwd } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 100,
      sortDirection: 'desc',
      sortKey: 'updated_at',
    })) as { data?: unknown; nextCursor?: unknown }
    if (
      Array.isArray(result.data) &&
      result.data.some(
        (value) =>
          value !== null &&
          typeof value === 'object' &&
          (value as { id?: unknown }).id === threadId &&
          (!allowedRoot || pathIsWithin((value as { cwd?: unknown }).cwd, allowedRoot)),
      )
    )
      return true
    cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
  } while (cursor)
  return false
}

export function projectIsAllowed(
  actualProjectId: string | null,
  requestedProjectId: string | undefined,
  cwd: string,
  project: ProjectLocation | undefined,
  userRoot: string,
) {
  return requestedProjectId === undefined
    ? actualProjectId === null && pathIsWithin(cwd, userRoot)
    : actualProjectId === requestedProjectId && Boolean(project?.path)
}
