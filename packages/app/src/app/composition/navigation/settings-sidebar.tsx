import { useNativeEnter } from '@/lib/platform/browser/use-native-enter'
import { ArrowLeft } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  SidebarSectionHeading,
  SidebarSectionItems,
} from '@/components/shared/sidebar'

export function SettingsSidebar({
  archivedActive,
  connectionActive,
  onBack,
  onGeneral,
  onConnection,
  onArchived,
  archivedDisabled = false,
  archivedDisabledMessage = 'Archived chats are unavailable.',
  showArchived = true,
  sidebarWidth,
  onSidebarWidthChange,
}: {
  archivedActive: boolean
  connectionActive: boolean
  onBack: () => void
  onGeneral: () => void
  onConnection: () => void
  onArchived: () => void
  archivedDisabled?: boolean
  archivedDisabledMessage?: string
  showArchived?: boolean
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const sidebarRef = useNativeEnter<HTMLElement>([], { duration: 0.22, y: 0 })

  return (
    <Sidebar ref={sidebarRef} width={sidebarWidth} onWidthChange={onSidebarWidthChange}>
      <SidebarHeader className="gap-1 p-3">
        <SidebarItem icon={<ArrowLeft data-icon="inline-start" />} onClick={onBack}>
          Back to app
        </SidebarItem>
      </SidebarHeader>
      <SidebarContent>
        <SidebarSection>
          <SidebarSectionHeading>Personal</SidebarSectionHeading>
          <SidebarSectionItems>
            <SidebarItem onClick={onGeneral} active={!archivedActive && !connectionActive}>
              General
            </SidebarItem>
            <SidebarItem onClick={onConnection} active={connectionActive}>
              Connection
            </SidebarItem>
          </SidebarSectionItems>
        </SidebarSection>
        {showArchived ? (
          <SidebarSection className="mt-2">
            <SidebarSectionHeading>Archived</SidebarSectionHeading>
            <SidebarSectionItems>
              <SidebarItem
                onClick={onArchived}
                disabled={archivedDisabled}
                title={archivedDisabled ? archivedDisabledMessage : undefined}
                active={archivedActive}
              >
                Archived chats
              </SidebarItem>
            </SidebarSectionItems>
          </SidebarSection>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}
