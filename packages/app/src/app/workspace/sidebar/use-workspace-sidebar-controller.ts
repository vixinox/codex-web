import * as React from 'react'

import {
  createProject as requestCreateProject,
  deleteProject as requestDeleteProject,
  fetchProjects,
  renameProject as requestRenameProject,
  type ProjectSummary,
} from '@/lib/bridge/http/projects'
import {
  archiveThread as requestArchiveThread,
  deleteThread as requestDeleteThread,
  fetchThreads,
} from '@/lib/bridge/http/threads'
import { subscribeToEvents } from '@/lib/bridge/events/event-source'
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
        list: fetchProjects,
        create: requestCreateProject,
        rename: requestRenameProject,
        delete: requestDeleteProject,
      },
      threads: {
        list: (projectId, signal) => fetchThreads(projectId, signal),
        archive: requestArchiveThread,
        delete: requestDeleteThread,
      },
      subscribeToWorkspaceEvents: (onEvent) =>
        subscribeToEvents({
          url: '/api/events?scope=workspace',
          events: ['thread/archived', 'thread/unarchived', 'thread/closed', 'thread/deleted'],
          onEvent,
        }),
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
