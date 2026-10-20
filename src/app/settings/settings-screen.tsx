import { AppearanceSection } from '@/app/settings/appearance-section'
// import { ConfigurationSection } from '@/app/settings/configuration-section'
import { CredentialPanel } from '@/app/settings/credential/credential-panel'
import { useSettingsController } from '@/app/settings/credential/use-settings-controller'
import { GuestCapacitySection } from '@/app/settings/guest-capacity-section'
import { ArchivedChats } from '@/app/settings/archived-chats'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

export function SettingsScreen({
  runtime,
  isGuest = false,
  archived = false,
}: {
  runtime?: CodexRuntimeController
  isGuest?: boolean
  archived?: boolean
}) {
  return (
    <main className="flex h-full flex-1 flex-col overflow-auto overscroll-none text-foreground">
      <div
        className="pointer-events-none sticky top-0 z-10 -mb-14 flex h-10 min-h-14 shrink-0 bg-linear-to-b from-app-surface from-80% to-transparent"
        aria-hidden="true"
      />
      <div className="px-8 py-20 xl:py-24">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-16">
          {archived ? (
            <ArchivedChats />
          ) : (
            <>
              <AppearanceSection />
              {isGuest ? <GuestCapacitySection /> : null}
              {/* <ConfigurationSection runtime={runtime} /> */}
              {runtime ? <OwnerCredentialSection runtime={runtime} /> : null}
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function OwnerCredentialSection({ runtime }: { runtime: CodexRuntimeController }) {
  const controller = useSettingsController(runtime)
  return <CredentialPanel controller={controller} />
}
