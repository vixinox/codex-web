export type WorkspaceThread = {
  id: string
  title: string
  status: 'notLoaded' | 'idle' | 'systemError' | 'active'
  updatedAt: number
  sourceLabel?: string
}

export type WorkspaceProject = {
  id: string
  name: string
  /** Stable UI identity for a project created before the server returns its ID. */
  presentationKey?: string
  /** A local write is in flight, so the row must not accept another action. */
  pending?: boolean
  threads:
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; items: readonly WorkspaceThread[] }
}

export type WorkspaceProjectSummary = Pick<WorkspaceProject, 'id' | 'name'>

export type WorkspaceSidebarModel =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      rootThreads:
        | { status: 'loading' }
        | { status: 'error'; message: string }
        | { status: 'ready'; items: readonly WorkspaceThread[] }
      projects: readonly WorkspaceProject[]
    }
