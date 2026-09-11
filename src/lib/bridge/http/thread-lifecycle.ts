import { ApiRequestError } from './credentials'

export async function archiveThread(projectId: string | null, threadId: string): Promise<void> {
  const query = new URLSearchParams()
  if (projectId) query.set('projectId', projectId)
  const suffix = query.size ? `?${query}` : ''
  let response: Response
  try {
    response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/archive${suffix}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
  if (!response.ok) {
    const message =
      response.status === 404
        ? 'This thread could not be found.'
        : response.status === 401
          ? 'Your session has expired. Sign in again to archive threads.'
          : 'Could not archive this thread. Try again.'
    throw new ApiRequestError(message, response.status)
  }
}

export async function unarchiveThread(projectId: string | null, threadId: string): Promise<void> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/unarchive${query}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok)
    throw new ApiRequestError('Could not unarchive this thread. Try again.', response.status)
}

export async function deleteThread(projectId: string | null, threadId: string): Promise<void> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}${query}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok)
    throw new ApiRequestError('Could not delete this thread. Try again.', response.status)
}

export async function deleteAllArchivedThreads(): Promise<void> {
  const response = await fetch('/api/threads?archived=true', {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok)
    throw new ApiRequestError('Could not delete archived chats. Try again.', response.status)
}
