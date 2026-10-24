import { ComposerInput } from '@/app/chat/composer/ui/composer-input'
import { EMPTY_OWNER_COMPOSER_CAPABILITIES } from '@/app/chat/composer/model/composer-capabilities'
import { ProjectPicker } from '@/app/chat/composer/ui/project-picker'
import type { ThreadPageSession } from '@/app/chat/session/interface'
import { RuntimePlaceholder } from '@/app/workspace/runtime/runtime-placeholder'
import { SettingsScreen } from '@/app/settings/settings-screen'
import { ThreadComposerSlot } from '@/app/chat/composer/ui/thread-composer-slot'
import { ThreadPageSurface } from '@/app/chat/transcript/thread-page-surface'
import type { WorkspaceRouteController } from '@/app/composition/routes/use-workspace-route-controller'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import type { WorkspaceSidebarController } from '@/app/workspace/sidebar/use-workspace-sidebar-controller'
import type { WorkspaceOrchestration } from '@/app/workspace/use-workspace-orchestration'
import type { ComposerCapabilities } from '@/app/chat/composer/model/composer-capabilities'

function ThreadHeader({ title }: { title?: string | null }) {
  return (
    <div className="relative z-10 -mb-14 flex h-10 min-h-14 items-center bg-linear-to-b from-app-surface from-80% to-transparent px-4 py-3 pl-16 xl:pl-4">
      {title ? (
        <h1 className="max-w-[40ch] truncate leading-6 font-medium" title={title}>
          {title}
        </h1>
      ) : (
        <div aria-hidden="true" />
      )}
    </div>
  )
}

export function WorkspacePageContent({
  route,
  runtime,
  page,
  controller,
  orchestration,
  selectedNewChatProjectId,
  capabilities,
}: {
  route?: WorkspaceRouteController
  runtime?: CodexRuntimeController
  page?: ThreadPageSession
  controller?: WorkspaceSidebarController
  orchestration?: WorkspaceOrchestration
  selectedNewChatProjectId?: string | null
  capabilities?: ComposerCapabilities
}) {
  if (!runtime || !route || !page || !controller || !orchestration) return null
  const projects = controller.model.status === 'ready' ? controller.model.projects : []
  const ready = runtime.model.status === 'started'
  const surfacePage = page
  const threadLoading = Boolean(route.selection && page.model.status !== 'ready')

  return (
    <>
      {surfacePage.model.status === 'ready' ? (
        <ThreadHeader title={surfacePage.model.thread.title} />
      ) : null}
      <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-auto overscroll-none">
        {route.settingsActive ? (
          route.archivedChatsActive && !ready ? (
            <RuntimePlaceholder
              model={runtime.model}
              onRetry={runtime.start}
              onOpenSettings={route.openSettings}
            />
          ) : (
            <SettingsScreen runtime={runtime} archived={route.archivedChatsActive} />
          )
        ) : ready && !threadLoading ? (
          <ThreadPageSurface controller={surfacePage} onRetry={() => page.actions.retry()} />
        ) : (
          <RuntimePlaceholder
            model={runtime.model}
            onRetry={runtime.start}
            onOpenSettings={route.openSettings}
          />
        )}
      </div>
      {ready && !route.settingsActive && !threadLoading ? (
        <div className="z-10 flex-none pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {page.model.status === 'empty' ? (
            <ComposerInput
              viewModel={page.composer}
              actions={page.actions}
              leadingContent={
                <ProjectPicker
                  projects={projects}
                  projectsLoading={controller.model.status === 'loading'}
                  selectedProjectId={route.selection?.projectId ?? selectedNewChatProjectId ?? null}
                  disabled={false}
                  onProjectChange={route.openNewChat}
                  onCreateProject={orchestration.createProject}
                />
              }
              capabilities={capabilities ?? EMPTY_OWNER_COMPOSER_CAPABILITIES}
            />
          ) : (
            <ThreadComposerSlot
              slot={page.composerSlot}
              actions={page.actions}
              capabilities={capabilities ?? page.capabilities}
            />
          )}
        </div>
      ) : null}
    </>
  )
}
