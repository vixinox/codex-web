import { AppearanceSection } from "@/app/settings/appearance/appearance-section";
import { cn } from "@/lib/utils";
import { SettingsSidebar } from "../../navigation/settings-sidebar";

export function MockSettingsPreview({ className }: { className?: string }) {

  return (
    <div
      className={cn(
        'relative aspect-16/10 w-full max-w-7xl overflow-hidden rounded-3xl border border-app-border bg-sidebar',
        className,
      )}
    >
      <div className="absolute inset-0 flex min-w-230">
        <SettingsSidebar
          archivedActive={false}
          onBack={() => { }}
          onGeneral={() => { }}
          onArchived={() => undefined}
          showArchived={false}
        />
        <main className="flex min-w-0 flex-1 flex-col rounded-tl-3xl bg-app-surface">
          <div className="h-full flex-1 overflow-auto px-6 py-12 text-foreground sm:px-12">
            <div className="mx-auto w-full max-w-2xl">
              <AppearanceSection />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
