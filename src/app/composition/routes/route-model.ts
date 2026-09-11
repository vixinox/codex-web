export type AppRoute =
  | { kind: 'threadPage'; projectId: string | null; threadId: string | null }
  | { kind: 'thread'; projectId: string | null; threadId: string }
  | { kind: 'settings'; section: 'general' | 'archived' }

export function decodeThreadSelection(pathname: string) {
  const rootMatch = pathname.match(/^\/app\/threads\/([^/]+)$/)
  if (rootMatch?.[1]) {
    try {
      return { projectId: null, threadId: decodeURIComponent(rootMatch[1]) }
    } catch {
      return null
    }
  }
  const match = pathname.match(/^\/app\/projects\/([^/]+)\/threads\/([^/]+)$/)
  if (!match?.[1] || !match[2]) return null
  try {
    return { projectId: decodeURIComponent(match[1]), threadId: decodeURIComponent(match[2]) }
  } catch {
    return null
  }
}

export function decodeThreadPageTarget(pathname: string, search = '') {
  const selection = decodeThreadSelection(pathname)
  if (selection) return selection
  if (pathname === '/app' || pathname === '/app/') {
    return { projectId: new URLSearchParams(search).get('projectId'), threadId: null }
  }
  return null
}

export function appPathForThread(projectId: string | null, threadId: string) {
  return projectId
    ? `/app/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`
    : `/app/threads/${encodeURIComponent(threadId)}`
}

export function appPathForNewChat(projectId: string | null = null) {
  return projectId ? `/app?projectId=${encodeURIComponent(projectId)}` : '/app'
}
