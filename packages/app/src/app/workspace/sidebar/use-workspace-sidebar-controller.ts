import * as React from 'react'

import { ownerWorkspace, type ProjectSummary } from '@/app/workspace/domain/owner-workspace'
import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
import type { WorkspaceThread, WorkspaceSidebarModel } from '@/app/workspace/workspace-model'
import type { WorkspaceRuntimeModel } from '@/app/workspace/runtime/use-codex-runtime-controller'
import {
  createWorkspaceCatalog,
  type WorkspaceCatalog,
  type WorkspaceCatalogActiveThread,
  type WorkspaceCatalogActions,
} from '@/app/workspace/application/workspace-catalog'

type WorkspaceSidebarRuntimeSource = {
  model: WorkspaceRuntimeModel
  reportUnavailable: () => void
}

export type WorkspaceSidebarActiveThread = WorkspaceCatalogActiveThread

export type WorkspaceSidebarController = WorkspaceCatalogActions & {
  model: WorkspaceSidebarModel
}

export function useWorkspaceSidebarController(
  runtimeSource: WorkspaceSidebarRuntimeSource,
  activeThread: WorkspaceSidebarActiveThread = null,
): WorkspaceSidebarController {
  const catalogRef = React.useRef<WorkspaceCatalog | null>(null)
  if (!catalogRef.current) {
    catalogRef.current = createWorkspaceCatalog({
      projects: {
        list: ownerWorkspace.projects.list,
        create: ownerWorkspace.projects.create,
        rename: ownerWorkspace.projects.rename,
        delete: ownerWorkspace.projects.delete,
      },
      threads: {
        list: (projectId, signal) => ownerWorkspace.threads.list(projectId, signal),
        archive: ownerWorkspace.threads.archive,
        delete: ownerWorkspace.threads.delete,
      },
      subscribeToWorkspaceEvents: (onEvent) =>
        (() => {
          const stream = getOwnerBridge().openStream(
            { method: 'events.subscribe', params: { scope: 'workspace' } },
            { onEvent: () => onEvent(new Event('workspace')) },
          )
          return () => stream.cancel()
        })(),
    })
  }
  const catalog = catalogRef.current
  const model = React.useSyncExternalStore(
    catalog.subscribe,
    catalog.getSnapshot,
    catalog.getSnapshot,
  )
  const runtimeReady = runtimeSource.model.status === 'started'
  const reportUnavailable = runtimeSource.reportUnavailable

  React.useEffect(() => {
    catalog.connect({
      ready: runtimeReady,
      onUnavailable: reportUnavailable,
    })
    return () => catalog.disconnect()
  }, [catalog, reportUnavailable, runtimeReady])

  React.useEffect(() => {
    catalog.observeActiveThread(activeThread)
  }, [activeThread, catalog])

  return React.useMemo(() => ({ model, ...catalog.actions }), [catalog.actions, model])
}

export type { ProjectSummary }
export type { WorkspaceThread }
