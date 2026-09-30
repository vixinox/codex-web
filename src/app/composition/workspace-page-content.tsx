import { ComposerInput } from '@/app/chat/composer/ui/composer-input'
import { EMPTY_OWNER_COMPOSER_CAPABILITIES } from '@/app/chat/composer/model/composer-capabilities'
import { ProjectPicker } from '@/app/chat/composer/ui/project-picker'
import type { useThreadPageController } from '@/app/chat/session/controllers/use-thread-page-controller'
import { RuntimePlaceholder } from '@/app/composition/screens/runtime-placeholder'
import { SettingsScreen } from '@/app/composition/screens/settings-screen'
import { ThreadComposerSlot } from '@/app/composition/screens/thread-composer'
import { ThreadPageSurface } from '@/app/composition/screens/thread-page'
import type { WorkspaceRouteController } from '@/app/composition/routes/use-workspace-route-controller'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import type { WorkspaceSidebarController } from '@/app/workspace/sidebar/use-workspace-sidebar-controller'
import type { useWorkspaceOrchestration } from '@/app/workspace/use-workspace-orchestration'
import type { GuestWorkspaceController } from '@/app/workspace/guest/use-guest-workspace-controller'
import { ThreadEmptyState } from '@/app/composition/layout/thread-empty-state'
import { ComposerContainer } from '@/app/composition/layout/composer-container'
import { ThreadAssets } from '@/app/chat/transcript/thread-assets'
import type { ComposerCapabilities } from '@/app/chat/composer/model/composer-capabilities'

type ThreadPageController = ReturnType<typeof useThreadPageController>
type WorkspaceOrchestration = ReturnType<typeof useWorkspaceOrchestration>

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
  guest,
  capabilities,
}: {
  route?: WorkspaceRouteController
  runtime?: CodexRuntimeController
  page?: ThreadPageController
  controller?: WorkspaceSidebarController
  orchestration?: WorkspaceOrchestration
  selectedNewChatProjectId?: string | null
  guest?: GuestWorkspaceController
  capabilities?: ComposerCapabilities
}) {
  if (guest) return <GuestWorkspacePageContent guest={guest} />
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
          <ThreadPageSurface controller={surfacePage} onRetry={page.actions.retry} />
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

function GuestWorkspacePageContent({ guest }: { guest: GuestWorkspaceController }) {
  const activeThread = guest.activeThread
  if (guest.settingsActive) return <SettingsScreen isGuest />
  return (
    <>
      {activeThread && !guest.threadLoading ? <ThreadHeader title={activeThread.title} /> : null}
      <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-auto overscroll-none">
        {guest.threadLoading ? null : activeThread ? (
          <section
            className="relative flex min-h-full flex-col"
            aria-label="Guest chat conversation"
          >
            {guest.detail.model.status === 'ready' ? (
              <ThreadAssets thread={activeThread} session={guest.detail.model.session} />
            ) : null}
          </section>
        ) : (
          <ThreadEmptyState
            title="What would you like to explore?"
            ariaLabel="Start a guest chat"
          />
        )}
      </div>
      {!guest.threadLoading ? (
        <div className="z-10 flex-none pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {activeThread && guest.composerSlot ? (
            <ThreadComposerSlot
              slot={guest.composerSlot}
              actions={guest.threadComposerActions}
              capabilities={guest.composer.capabilities}
            />
          ) : (
            <ComposerContainer>
              <ComposerInput
                viewModel={guest.composer.viewModel}
                actions={guest.composer.actions}
                placeholder="Explore the isolated guest workspace"
                capabilities={guest.composer.capabilities}
              />
            </ComposerContainer>
          )}
        </div>
      ) : null}
    </>
  )
}
