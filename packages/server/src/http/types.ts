import type { ServerConfig } from '../config.js'
import type { WorkspaceService } from '../workspace.js'
import type { CodexOwnerPort } from '../codex/owner-port.js'
import type { OwnerConnector } from '../remote/connector.js'

export type AppDependencies = {
  ownerId: string
  database?: import('../database.js').Database
  workspace: WorkspaceService & { hasOwner?: () => Promise<boolean> }
  codex: CodexOwnerPort
  remote?: OwnerConnector
}

export type RouteContext = {
  config: ServerConfig
  dependencies: AppDependencies
}
