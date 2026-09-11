import * as React from 'react'
import { FolderIcon, RefreshCwIcon } from 'lucide-react'
import type { ProjectSummary } from '@/lib/bridge/http/projects'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { SettingsCollection } from '../model/types'

export function ProjectSection({
  projects,
  onRetry,
}: {
  projects: SettingsCollection<ProjectSummary>
  onRetry: () => void
}) {
  return (
    <ResourceSection
      heading="Projects"
      collection={projects}
      errorTitle="Could not load projects"
      onRetry={onRetry}
      empty={
        <Empty className="w-full border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderIcon />
            </EmptyMedia>
            <EmptyTitle>No projects</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(items) => (
        <ul className="divide-y rounded-lg border" aria-label="Projects">
          {items.map((project) => (
            <li key={project.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="truncate font-medium">{project.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Project</span>
            </li>
          ))}
        </ul>
      )}
    </ResourceSection>
  )
}

export function ResourceSection<T>({
  heading,
  collection,
  errorTitle,
  onRetry,
  empty,
  headerAction,
  children,
}: {
  heading: string
  collection: SettingsCollection<T>
  errorTitle: string
  onRetry: () => void
  empty: React.ReactNode
  headerAction?: React.ReactNode
  children: (items: readonly T[]) => React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-8" aria-labelledby={`offline-${heading}-heading`}>
      <div className="flex items-center justify-between gap-4">
        <h1 id={`offline-${heading}-heading`} className="text-xl">
          {heading}
        </h1>
        {headerAction}
      </div>
      {collection.status === 'loading' ? (
        <div />
      ) : collection.status === 'error' ? (
        <Alert variant="destructive" className="w-full">
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription>{collection.message}</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </Alert>
      ) : collection.items.length === 0 ? (
        empty
      ) : (
        children(collection.items)
      )}
    </section>
  )
}
