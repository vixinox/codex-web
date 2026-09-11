import * as React from 'react'
import { ComposerInput } from '@/app/chat/composer/composer-input'
import { GUEST_COMPOSER_CAPABILITIES } from '@/app/chat/composer/composer-capabilities'
import { ThreadAssets } from '@/app/chat/transcript/thread-assets'
import { SettingsSidebar } from '@/app/composition/navigation/settings-sidebar'
import { AppearanceSection } from '@/app/settings/appearance/appearance-section'
import { WorkspaceSidebar } from '@/app/workspace/sidebar/workspace-sidebar'
import { cn } from '@/lib/utils'
import {
  createMockComposerActions,
  createMockSidebarModel,
  createMockThread,
  MOCK_COMPOSER,
  MOCK_THREAD_ID,
} from './mock-data'

const MOCK_THREAD = createMockThread()
const MOCK_ACTIONS = createMockComposerActions(
  () => undefined,
  async () => undefined,
  () => undefined,
  () => undefined,
  () => undefined,
)

export function MockWorkspacePreview({ className }: { className?: string }) {
  const [settingsActive, setSettingsActive] = React.useState(false)

  return (
    <div
      className={cn(
        'relative aspect-16/10 w-full max-w-7xl overflow-hidden rounded-3xl border border-app-border bg-sidebar',
        className,
      )}
    >
      <div className="absolute inset-0 flex min-w-230">
        {settingsActive ? (
          <SettingsSidebar
            archivedActive={false}
            onBack={() => setSettingsActive(false)}
            onGeneral={() => setSettingsActive(true)}
            onArchived={() => undefined}
            showArchived={false}
          />
        ) : (
          <WorkspaceSidebar
            model={createMockSidebarModel()}
            runtimeStatus="started"
            runtimeStatusLabel="Started"
            activeThreadId={MOCK_THREAD_ID}
            settingsActive={false}
            newChatActive={false}
            onOpenSettings={() => setSettingsActive(true)}
            onStartCodex={async () => true}
            onSignOut={async () => undefined}
            onOpenNewChat={() => undefined}
            onSelectThread={() => undefined}
            onSelectRootThread={() => undefined}
            onRetryProjects={() => undefined}
            onRetryThreads={() => undefined}
            onRetryRootThreads={() => undefined}
            onArchiveThread={async () => undefined}
            onOpenProjectChat={() => undefined}
            onCreateProject={async () => undefined}
            onRenameProject={async () => undefined}
            onDeleteProject={async () => undefined}
            persistUiState={false}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col rounded-tl-3xl bg-app-surface">
          {settingsActive ? (
            <div className="h-full flex-1 overflow-auto px-6 py-12 text-foreground sm:px-12">
              <div className="mx-auto w-full max-w-2xl">
                <AppearanceSection />
              </div>
            </div>
          ) : (
            <>
              <header className="relative z-10 -mb-14 min-h-14 rounded-tl-3xl bg-linear-to-b from-app-surface from-70% to-transparent p-4 pb-6">
                <h1 className="max-w-[40ch] truncate font-medium">{MOCK_THREAD.title}</h1>
              </header>
              <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-auto">
                <ThreadAssets
                  thread={MOCK_THREAD}
                  retryState={null}
                  lockEpoch={0}
                  compacting={false}
                />
              </div>
              <div className="z-10 flex-none pb-4">
                <div className="relative z-10 -mt-14 flex-none bg-linear-to-t from-app-surface from-80% to-transparent">
                  <div className="mx-auto w-full max-w-3xl">
                    <ComposerInput
                      viewModel={MOCK_COMPOSER}
                      actions={MOCK_ACTIONS}
                      capabilities={GUEST_COMPOSER_CAPABILITIES}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
