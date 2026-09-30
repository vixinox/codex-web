import { AppearanceSection } from '@/app/settings/appearance-section'
import { cn } from '@/lib/utils'
import { SettingsSidebar } from '../../navigation/settings-sidebar'

export function MockSettingsPreview({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative min-h-[40rem] w-full max-w-7xl overflow-hidden rounded-3xl border bg-sidebar sm:aspect-16/10 sm:min-h-0',
        className,
      )}
    >
      <div className="absolute inset-0 flex min-w-0">
        <div className="hidden w-56 shrink-0 sm:flex xl:w-72">
          <SettingsSidebar
            archivedActive={false}
            onBack={() => {}}
            onGeneral={() => {}}
            onArchived={() => undefined}
            showArchived={false}
          />
        </div>
        <main className="flex min-w-0 flex-1 flex-col rounded-tl-3xl bg-app-surface">
          <div className="h-full flex-1 overflow-auto px-4 py-8 text-foreground sm:px-12 sm:py-12">
            <div className="mx-auto w-full max-w-2xl">
              <AppearanceSection />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
