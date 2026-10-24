import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'

import {
  appPathForNewChat,
  appPathForThread,
  decodeThreadPageTarget,
  decodeThreadSelection,
} from './route-model'

export type WorkspaceRouteController = {
  settingsActive: boolean
  archivedChatsActive: boolean
  selection: ReturnType<typeof decodeThreadSelection>
  requestedProjectId: string | null
  pageTarget: ReturnType<typeof decodeThreadPageTarget>
  activeThreadId: string | null
  newChatActive: boolean
  openApp: () => void
  openSettings: () => void
  openArchivedChats: () => void
  openNewChat: (projectId?: string | null, replace?: boolean) => void
  navigateToThread: (projectId: string | null, threadId: string) => void
  leaveThread: () => void
  handleThreadLifecycle: () => void
}

export function useWorkspaceRouteController(): WorkspaceRouteController {
  const location = useLocation()
  const navigate = useNavigate()
  const settingsActive = location.pathname.startsWith('/app/settings')
  const archivedChatsActive = location.pathname === '/app/settings/archived-chats'
  const selection = decodeThreadSelection(location.pathname)
  const requestedProjectId = new URLSearchParams(location.search).get('projectId')
  const pageTarget = decodeThreadPageTarget(location.pathname, location.search)
  const activeThreadId = selection?.threadId ?? null
  const newChatActive = !settingsActive && !selection
  const settingsReturn = (location.state as { settingsReturn?: string } | null)?.settingsReturn

  const workspaceReturnRef = React.useRef<{ pathname: string; search: string } | null>(null)
  React.useEffect(() => {
    if (!settingsActive && pageTarget) {
      workspaceReturnRef.current = { pathname: location.pathname, search: location.search }
    }
  }, [location.pathname, location.search, pageTarget, settingsActive])
  const openApp = React.useCallback(() => {
    const target = workspaceReturnRef.current
    void navigate(settingsReturn ?? (target ? `${target.pathname}${target.search}` : '/app'))
  }, [navigate, settingsReturn])
  const openSettings = React.useCallback(() => {
    const target = pageTarget ? `${location.pathname}${location.search}` : '/app'
    void navigate('/app/settings', { state: { settingsReturn: target } })
  }, [location.pathname, location.search, navigate, pageTarget])
  const openArchivedChats = React.useCallback(
    () => navigate('/app/settings/archived-chats'),
    [navigate],
  )
  const openNewChat = React.useCallback(
    (projectId: string | null = null, replace = false) => {
      void navigate(appPathForNewChat(projectId), replace ? { replace: true } : undefined)
    },
    [navigate],
  )
  const navigateToThread = React.useCallback(
    (projectId: string | null, threadId: string) => navigate(appPathForThread(projectId, threadId)),
    [navigate],
  )
  const leaveThread = React.useCallback(
    () => openNewChat(selection?.projectId ?? null, true),
    [openNewChat, selection?.projectId],
  )

  return {
    settingsActive,
    archivedChatsActive,
    selection,
    requestedProjectId,
    pageTarget,
    activeThreadId,
    newChatActive,
    openApp,
    openSettings,
    openArchivedChats,
    openNewChat,
    navigateToThread,
    leaveThread,
    handleThreadLifecycle: leaveThread,
  }
}

export function useWorkspaceProjectRouteValidation(
  route: Pick<WorkspaceRouteController, 'newChatActive' | 'requestedProjectId'>,
  projectIds: readonly string[] | null,
) {
  const navigate = useNavigate()
  const selectedNewChatProjectId =
    route.requestedProjectId && projectIds?.includes(route.requestedProjectId)
      ? route.requestedProjectId
      : null

  React.useEffect(() => {
    if (
      !route.newChatActive ||
      !route.requestedProjectId ||
      projectIds === null ||
      projectIds.includes(route.requestedProjectId)
    )
      return
    void navigate('/app', { replace: true })
  }, [navigate, projectIds, route.newChatActive, route.requestedProjectId])

  return selectedNewChatProjectId
}
