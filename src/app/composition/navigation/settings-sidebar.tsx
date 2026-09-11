import { useGsapEnter } from '@/lib/platform/browser/use-gsap-enter'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SettingsSidebar({
  archivedActive,
  onBack,
  onGeneral,
  onArchived,
  archivedDisabled = false,
  archivedDisabledMessage = 'Archived chats are unavailable in Guest Workspace.',
  showArchived = true,
}: {
  archivedActive: boolean
  onBack: () => void
  onGeneral: () => void
  onArchived: () => void
  archivedDisabled?: boolean
  archivedDisabledMessage?: string
  showArchived?: boolean
}) {
  const sidebarRef = useGsapEnter<HTMLElement>([], { duration: 0.22, y: 0 })

  return (
    <aside ref={sidebarRef} className="flex h-full w-72 shrink-0 flex-col">
      <div className="flex flex-col gap-1 p-3">
        <Button variant="ghost" className="w-full justify-start font-normal" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Back to app
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="flex items-center px-2 py-2 text-sm font-medium text-muted-foreground select-none">
          Personal
        </div>
        <div className="flex flex-col gap-0.5">
          <Button
            variant="ghost"
            className="w-full justify-start font-normal"
            onClick={onGeneral}
            aria-current={!archivedActive ? 'page' : undefined}
          >
            General
          </Button>
        </div>
        {showArchived ? (
          <>
            <div className="mt-2 flex items-center px-2 py-2 text-sm font-medium text-muted-foreground select-none">
              Archived
            </div>
            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                className="w-full justify-start font-normal"
                onClick={onArchived}
                disabled={archivedDisabled}
                title={archivedDisabled ? archivedDisabledMessage : undefined}
                aria-current={archivedActive ? 'page' : undefined}
              >
                Archived chats
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
