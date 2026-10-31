import * as React from 'react'
import { FolderClosed, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ownerWorkspace } from '@/app/workspace/domain/owner-workspace'
import type { ThreadSummary } from '@/lib/bridge/interfaces/thread'
import { Separator } from '@/components/ui/separator'
import { SettingsSection, SettingsSectionContent } from './settings-page-layout'

export function ArchivedChats() {
  const [items, setItems] = React.useState<readonly ThreadSummary[]>([])
  const [query, setQuery] = React.useState('')
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [projectNames, setProjectNames] = React.useState<Record<string, string>>({})
  const [deleteAllOpen, setDeleteAllOpen] = React.useState(false)
  const load = React.useCallback(async () => {
    setError(null)
    try {
      const [threads, projects] = await Promise.all([
        ownerWorkspace.threads.list(null, undefined, true),
        ownerWorkspace.projects.list(),
      ])
      setItems(threads)
      setProjectNames(Object.fromEntries(projects.map((project) => [project.id, project.name])))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load archived chats.')
    } finally {
      setHasLoaded(true)
    }
  }, [])
  React.useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])
  const visible = items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
  const groups = React.useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; items: ThreadSummary[] }>()
    for (const item of visible) {
      const key = item.projectId ?? '__no_project__'
      const existing = grouped.get(key)
      if (existing) existing.items.push(item)
      else {
        grouped.set(key, {
          id: key,
          name: item.projectId ? (projectNames[item.projectId] ?? 'Unknown project') : 'No project',
          items: [item],
        })
      }
    }
    return [...grouped.values()]
  }, [projectNames, visible])
  const run = React.useCallback(
    async (action: () => Promise<void>) => {
      setError(null)
      try {
        await action()
        await load()
        return true
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : 'Could not update archived chats.',
        )
        return false
      }
    },
    [load],
  )
  return (
    <SettingsSection
      title="Archived chats"
      headingLevel={1}
      action={
        <Button variant="destructive" onClick={() => setDeleteAllOpen(true)}>
          <Trash2 />
          Delete all
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="max-w-2/3 rounded-full pl-10"
              placeholder="Search archived chats"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {error ? (
          <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        <SettingsSectionContent ready={hasLoaded} message="Loading archived chats...">
          {visible.length === 0 ? (
            <p className="text-muted-foreground">No archived chats</p>
          ) : (
            <div className="flex flex-col gap-10">
              {groups.map((group) => (
                <section key={group.id}>
                  <div className="mb-4 flex items-center justify-between px-1">
                    <div className="flex items-center gap-3">
                      <FolderClosed className="size-4" />
                      {group.name}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {group.items.length} {group.items.length === 1 ? 'chat' : 'chats'}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border bg-app-surface">
                    {group.items.map((item, index) => (
                      <React.Fragment key={item.id}>
                        <article className="flex items-center justify-between gap-6 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm">{item.title}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {new Date(item.updatedAt * 1000).toLocaleString()}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete chat"
                              className="text-muted-foreground"
                              onClick={() =>
                                void run(() =>
                                  ownerWorkspace.threads.delete(item.projectId, item.id),
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                void run(() =>
                                  ownerWorkspace.threads.unarchive(item.projectId, item.id),
                                )
                              }
                            >
                              Unarchive
                            </Button>
                          </div>
                        </article>
                        {index < group.items.length - 1 ? (
                          <div className="px-4">
                            <Separator />
                          </div>
                        ) : null}
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </SettingsSectionContent>
      </div>
      {deleteAllOpen ? (
        <div role="dialog" className="fixed inset-0 grid place-items-center">
          <div className="w-full max-w-md rounded-xl border border-accent bg-app-surface-subtle p-6">
            <h2 className="text-lg font-medium">Delete all archived chats?</h2>
            <p className="mt-2 text-sm text-muted-foreground">This action cannot be undone.</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteAllOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  void run(ownerWorkspace.threads.deleteAllArchived).then((completed) => {
                    if (completed) setDeleteAllOpen(false)
                    return undefined
                  })
                }
              >
                Delete all
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
