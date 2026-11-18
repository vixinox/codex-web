import { AppearanceSection } from '@/app/settings/appearance-section'
import { CredentialPanel } from '@/app/settings/credential/credential-panel'
import { useSettingsController } from '@/app/settings/credential/use-settings-controller'
import { ArchivedChats } from '@/app/settings/archived-chats'
import { SettingsPageLayout } from '@/app/settings/settings-page-layout'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

export function SettingsScreen({
  runtime,
  archived = false,
}: {
  runtime?: CodexRuntimeController
  archived?: boolean
}) {
  return (
    <SettingsPageLayout resetKey={archived ? 'archived' : 'general'}>
      {archived ? (
        <ArchivedChats />
      ) : (
        <>
          <AppearanceSection />
          {runtime ? <OwnerCredentialSection runtime={runtime} /> : null}
        </>
      )}
    </SettingsPageLayout>
  )
}

function OwnerCredentialSection({ runtime }: { runtime: CodexRuntimeController }) {
  const controller = useSettingsController(runtime)
  return <CredentialPanel controller={controller} />
}
