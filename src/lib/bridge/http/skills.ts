import { ApiRequestError } from './credentials'

export type AvailableSkill = {
  handle: string
  name: string
  displayName: string
  description: string
  scope: 'user' | 'repo' | 'system' | 'admin'
}

function isAvailableSkill(value: unknown): value is AvailableSkill {
  if (!value || typeof value !== 'object') return false
  const skill = value as Record<string, unknown>
  return (
    typeof skill.handle === 'string' &&
    typeof skill.name === 'string' &&
    typeof skill.displayName === 'string' &&
    typeof skill.description === 'string' &&
    ['user', 'repo', 'system', 'admin'].includes(String(skill.scope))
  )
}

export async function fetchSkills(
  projectId: string | null,
  signal?: AbortSignal,
): Promise<AvailableSkill[]> {
  const query = new URLSearchParams()
  if (projectId) query.set('projectId', projectId)
  let response: Response
  try {
    response = await fetch(`/api/skills${query.size ? `?${query}` : ''}`, {
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
    try {
      const body = (await response.json()) as { error?: { code?: unknown } }
      if (typeof body.error?.code === 'string') code = body.error.code
    } catch {
      // Keep the safe status-based message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to load skills.'
        : code === 'CODEX_START_REQUIRED'
          ? 'Start Codex in Settings before loading skills.'
          : response.status === 404
            ? 'The selected project no longer exists. Choose another project.'
            : 'Could not load skills right now.'
    throw new ApiRequestError(message, response.status, code)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError('The server returned an invalid skills response.', response.status)
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { data?: unknown }).data) ||
    !(body as { data: unknown[] }).data.every(isAvailableSkill)
  )
    throw new ApiRequestError('The server returned an invalid skills response.', response.status)
  return (body as { data: AvailableSkill[] }).data
}
