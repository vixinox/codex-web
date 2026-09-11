import { ApiRequestError } from './credentials'

export type ProjectSummary = {
  id: string
  name: string
  createdAt?: string | Date
  updatedAt?: string | Date
}

type ProjectsResponse = { projects?: unknown }

function isProjectSummary(value: unknown): value is ProjectSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.name === 'string'
}

function toProjectSummary(value: ProjectSummary): ProjectSummary {
  return {
    id: value.id,
    name: value.name,
    ...(typeof value.createdAt === 'string' || value.createdAt instanceof Date
      ? { createdAt: value.createdAt }
      : {}),
    ...(typeof value.updatedAt === 'string' || value.updatedAt instanceof Date
      ? { updatedAt: value.updatedAt }
      : {}),
  }
}

export async function fetchProjects(signal?: AbortSignal): Promise<readonly ProjectSummary[]> {
  let response: Response
  try {
    response = await fetch('/api/projects', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }

  if (!response.ok) {
    let code: string | null = null
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to view projects.'
        : response.status >= 500
          ? 'The server is temporarily unavailable.'
          : 'Could not load projects. Try again.'
    try {
      const body = (await response.json()) as { error?: { code?: unknown } }
      if (typeof body.error?.code === 'string') code = body.error.code
    } catch {
      // Keep the safe status message when the bridge response is not JSON.
    }
    throw new ApiRequestError(message, response.status, code)
  }

  let body: ProjectsResponse
  try {
    body = (await response.json()) as ProjectsResponse
  } catch {
    throw new ApiRequestError('The server returned an invalid projects response.', response.status)
  }
  if (!Array.isArray(body.projects) || !body.projects.every(isProjectSummary)) {
    throw new ApiRequestError('The server returned an invalid projects response.', response.status)
  }
  return body.projects.map(toProjectSummary)
}

export async function createProject(name: string): Promise<ProjectSummary> {
  return requestProject('/api/projects', 'POST', name)
}

export async function renameProject(id: string, name: string): Promise<ProjectSummary> {
  return requestProject(`/api/projects/${encodeURIComponent(id)}`, 'PATCH', name)
}

export async function deleteProject(id: string): Promise<void> {
  const response = await projectRequest(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await projectError(response, 'remove')
}

async function requestProject(
  path: string,
  method: 'POST' | 'PATCH',
  name: string,
): Promise<ProjectSummary> {
  const response = await projectRequest(path, {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw await projectError(response, method === 'POST' ? 'create' : 'rename')
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError('The server returned an invalid project response.', response.status)
  }
  if (!isProjectSummary(body))
    throw new ApiRequestError('The server returned an invalid project response.', response.status)
  return toProjectSummary(body)
}

async function projectRequest(path: string, init: RequestInit) {
  try {
    return await fetch(path, init)
  } catch {
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
}

async function projectError(response: Response, action: 'create' | 'rename' | 'remove') {
  let code: string | null = null
  try {
    const body = (await response.json()) as { error?: { code?: unknown } }
    if (typeof body.error?.code === 'string') code = body.error.code
  } catch {
    // Use the safe status-based message.
  }
  const message =
    response.status === 401
      ? 'Your session has expired. Sign in again.'
      : code === 'PROJECT_EXISTS'
        ? 'A project with this name already exists.'
        : response.status === 404
          ? 'This project no longer exists.'
          : response.status === 400
            ? 'Use 1-64 letters, numbers, dots, underscores, or hyphens.'
            : `Could not ${action} this project. Try again.`
  return new ApiRequestError(message, response.status, code)
}
