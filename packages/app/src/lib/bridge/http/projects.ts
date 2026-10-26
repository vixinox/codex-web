import { getOwnerBridge } from '../owner-runtime'

export type ProjectSummary = { id: string; name: string }

export async function fetchProjects(signal?: AbortSignal): Promise<readonly ProjectSummary[]> {
  return asProjects(await getOwnerBridge().request('projects.list', undefined, { signal }))
}

export async function createProject(name: string): Promise<ProjectSummary> {
  return asProject(await getOwnerBridge().request('projects.create', { name }, { mutation: true }))
}

export async function renameProject(id: string, name: string): Promise<ProjectSummary> {
  return asProject(
    await getOwnerBridge().request('projects.rename', { projectId: id, name }, { mutation: true }),
  )
}

export async function deleteProject(id: string): Promise<void> {
  await getOwnerBridge().request('projects.delete', { projectId: id }, { mutation: true })
}

function asProjects(value: unknown): readonly ProjectSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (isProject(item) ? [item] : []))
}

function asProject(value: unknown): ProjectSummary {
  if (!isProject(value)) throw new Error('Invalid project response.')
  return value
}

function isProject(value: unknown): value is ProjectSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.name === 'string'
}
