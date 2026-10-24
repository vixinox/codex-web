import {
  createProjectPathIndex,
  projectIdForThread,
  sanitizeThreadSummary,
  type ProjectLocation,
  type ThreadSummary,
} from '../thread-contract.js'
import {
  createThreadAccess,
  type ThreadAccessDependencies,
  type ThreadAccessRequest,
  type ThreadAccessResult,
} from '../thread-access.js'
import {
  createThreadCollection,
  type ThreadCollectionDependencies,
  type ThreadCollectionRequest,
  type ThreadCollectionResult,
} from '../thread-collection.js'
import { pathIsWithin, threadAppearsInCwd, type ThreadClient } from '../thread-ownership.js'

export type {
  ProjectLocation,
  ThreadAccessRequest,
  ThreadAccessResult,
  ThreadClient,
  ThreadCollectionRequest,
  ThreadCollectionResult,
  ThreadSummary,
}

export type ThreadDomainDependencies = ThreadAccessDependencies & ThreadCollectionDependencies

export type ThreadDomain = {
  access(request: ThreadAccessRequest): Promise<ThreadAccessResult>
  list(request: ThreadCollectionRequest): Promise<ThreadCollectionResult>
  createProjectPathIndex(projects: ProjectLocation[]): Map<string, string>
  projectIdFor(value: unknown, projects: Map<string, string>): string | null
  summarize(value: unknown, projectId: string | null): ThreadSummary | null
  pathIsWithin(value: unknown, root: string): boolean
  appearsInCwd(
    client: ThreadClient,
    threadId: string,
    cwd?: string,
    archived?: boolean,
    allowedRoot?: string,
  ): Promise<boolean>
}

/**
 * The single seam for thread ownership, collection, and browser-safe projections.
 * Routes should not need to coordinate these lower-level modules independently.
 */
export function createThreadDomain(dependencies: ThreadDomainDependencies): ThreadDomain {
  const access = createThreadAccess(dependencies)
  const collection = createThreadCollection(dependencies)

  return {
    access: access.access,
    list: collection.list,
    createProjectPathIndex,
    projectIdFor: projectIdForThread,
    summarize: sanitizeThreadSummary,
    pathIsWithin,
    appearsInCwd: threadAppearsInCwd,
  }
}
