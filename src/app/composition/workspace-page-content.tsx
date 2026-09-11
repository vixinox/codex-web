import * as React from 'react'

import { ThreadHeader } from '@/app/composition/layout/thread-header'
import { ComposerInput } from '@/app/chat/composer/composer-input'
import { OWNER_NEW_CHAT_COMPOSER_CAPABILITIES } from '@/app/chat/composer/composer-capabilities'
import { ProjectPicker } from '@/app/chat/composer/project-picker'
import type { useThreadPageController } from '@/app/chat/session/use-thread-page-controller'
import { RuntimePlaceholder } from '@/app/composition/screens/runtime-placeholder'
import { SettingsScreen } from '@/app/composition/screens/settings-screen'
import { ThreadComposerSlot } from '@/app/composition/screens/thread-composer'
import { ThreadPageSurface } from '@/app/composition/screens/thread-page'
import { ArchivedChats } from '@/app/settings/archived/archived-chats'
import type { WorkspaceRouteController } from '@/app/composition/routes/use-workspace-route-controller'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import type { WorkspaceSidebarController } from '@/app/workspace/sidebar/use-workspace-sidebar-controller'
import type { useWorkspaceOrchestration } from '@/app/workspace/use-workspace-orchestration'

type ThreadPageController = ReturnType<typeof useThreadPageController>
type WorkspaceOrchestration = ReturnType<typeof useWorkspaceOrchestration>

export function WorkspacePageContent({
  route,
  runtime,
  page,
  controller,
  orchestration,
  selectedNewChatProjectId,
}: {
  route: WorkspaceRouteController
  runtime: CodexRuntimeController
  page: ThreadPageController
  controller: WorkspaceSidebarController
  orchestration: WorkspaceOrchestration
  selectedNewChatProjectId: string | null
}) {
  const projects = controller.model.status === 'ready' ? controller.model.projects : []
  const ready = runtime.model.status === 'started'
  const bufferedThreadPage = React.useRef<ThreadPageController | null>(null)
  if (page.model.status === 'ready') bufferedThreadPage.current = page

  const showingBufferedThread = Boolean(
    !route.settingsActive &&
    route.selection &&
    (page.model.status === 'idle' || page.model.status === 'loading') &&
    bufferedThreadPage.current?.model.status === 'ready' &&
    bufferedThreadPage.current.model.thread.id !== route.selection.threadId,
  )
  const surfacePage = showingBufferedThread
    ? {
        ...bufferedThreadPage.current!,
        actions: page.actions,
        composer: page.composer,
        composerSlot: page.composerSlot,
        compacting: page.compacting,
        inputErrors: page.inputErrors,
        lockEpoch: page.lockEpoch,
        retryState: page.retryState,
      }
    : page

  return (
    <>
      {surfacePage.model.status === 'ready' ? (
        <ThreadHeader title={surfacePage.model.thread.title} />
      ) : null}
      <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-auto">
        {route.settingsActive ? (
          route.archivedChatsActive && ready ? (
            <ArchivedChats />
          ) : route.archivedChatsActive ? (
            <RuntimePlaceholder
              model={runtime.model}
              onRetry={runtime.start}
              onOpenSettings={route.openSettings}
            />
          ) : (
            <SettingsScreen runtime={runtime} />
          )
        ) : ready ? (
          <ThreadPageSurface controller={surfacePage} onRetry={page.actions.retry} />
        ) : (
          <RuntimePlaceholder
            model={runtime.model}
            onRetry={runtime.start}
            onOpenSettings={route.openSettings}
          />
        )}
      </div>
      {ready && !route.settingsActive ? (
        <div className="z-10 flex-none pb-4">
          {page.model.status === 'empty' ? (
            <ComposerInput
              viewModel={page.composer}
              actions={page.actions}
              leadingContent={
                <ProjectPicker
                  projects={projects}
                  projectsLoading={controller.model.status === 'loading'}
                  selectedProjectId={route.selection?.projectId ?? selectedNewChatProjectId}
                  disabled={false}
                  onProjectChange={route.openNewChat}
                  onCreateProject={orchestration.createProject}
                />
              }
              capabilities={OWNER_NEW_CHAT_COMPOSER_CAPABILITIES}
            />
          ) : (
            <ThreadComposerSlot slot={page.composerSlot} actions={page.actions} />
          )}
        </div>
      ) : null}
    </>
  )
}
