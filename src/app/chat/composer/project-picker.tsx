import * as React from 'react'
import { FolderClosed, FolderClosedIcon, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ProjectNameDialog } from '@/app/workspace/project/project-name-dialog'

export type ProjectPickerProject = {
  id: string
  name: string
}

type ProjectPickerProps = {
  projects: readonly ProjectPickerProject[]
  selectedProjectId: string | null
  projectsLoading: boolean
  disabled: boolean
  onProjectChange?: (projectId: string | null) => void
  onCreateProject?: (name: string) => Promise<void>
  /** Keeps the picker visible in Guest Workspace while preventing project calls. */
  unavailableMessage?: string
  onUnavailable?: () => void
}

export function ProjectPicker({
  projects,
  selectedProjectId,
  projectsLoading,
  disabled,
  onProjectChange,
  onCreateProject,
  unavailableMessage,
  onUnavailable,
}: ProjectPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false)
  const selectedProject = projects.find((project) => project.id === selectedProjectId)

  return (
    <div className="w-[96%] rounded-t-3xl bg-app-surface-subtle px-2 py-1">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (unavailableMessage && nextOpen) {
            onUnavailable?.()
            setOpen(false)
            return
          }
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="rounded-full font-light text-app-text-subtle"
              disabled={disabled}
              title={unavailableMessage}
            >
              <FolderClosed data-icon="inline-start" />
              <span>{selectedProject?.name ?? 'Choose project'}</span>
            </Button>
          }
        />
        <PopoverContent align="start" side="top" className="w-fit gap-0 p-0">
          {projectsLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading projects...</p>
          ) : (
            projects.map((project) => (
              <Button
                key={project.id}
                variant="ghost"
                className="w-full justify-start pr-8 text-xs"
                onClick={() => {
                  onProjectChange?.(project.id)
                  setOpen(false)
                }}
              >
                <FolderClosedIcon data-icon="inline-start" /> {project.name}
              </Button>
            ))
          )}

          <Button
            variant="ghost"
            className="w-full justify-start pr-8 text-xs"
            onClick={() => {
              setOpen(false)
              if (unavailableMessage) {
                onUnavailable?.()
                return
              }
              setCreateProjectOpen(true)
            }}
          >
            <Plus data-icon="inline-start" /> New project
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start pr-8 text-xs"
            onClick={() => {
              onProjectChange?.(null)
              setOpen(false)
            }}
          >
            <X data-icon="inline-start" /> Don't work in a project
          </Button>
        </PopoverContent>
      </Popover>
      {unavailableMessage ? null : (
        <ProjectNameDialog
          open={createProjectOpen}
          onOpenChange={setCreateProjectOpen}
          mode="create"
          onSubmit={async (name) => onCreateProject?.(name)}
        />
      )}
    </div>
  )
}
