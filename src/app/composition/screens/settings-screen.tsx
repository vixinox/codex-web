import { AppearanceSection } from '@/app/settings/appearance/appearance-section'
// import { ConfigurationSection } from '@/app/settings/configuration/configuration-section'
import { CredentialPanel } from '@/app/settings/credential/credential-panel'
import { useSettingsController } from '@/app/settings/credential/use-settings-controller'
import { GuestCapacitySection } from '@/app/settings/guest-capacity/guest-capacity-section'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

export function SettingsScreen({
  runtime,
  isGuest = false,
}: {
  runtime?: CodexRuntimeController
  isGuest?: boolean
}) {
  return (
    <main className="flex h-full flex-1 flex-col overflow-auto px-4 pt-24 text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-16">
        <AppearanceSection />
        {isGuest ? <GuestCapacitySection /> : null}
        {/* <ConfigurationSection runtime={runtime} /> */}
        {runtime ? <OwnerCredentialSection runtime={runtime} /> : null}
      </div>
    </main>
  )
}

function OwnerCredentialSection({ runtime }: { runtime: CodexRuntimeController }) {
  const controller = useSettingsController(runtime)
  return <CredentialPanel controller={controller} />
}
