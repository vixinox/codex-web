import type { Auth } from '../auth.js'
import type { ServerConfig } from '../config.js'
import type { NativeCodexMessage } from '../codex/native-protocol.js'
import type { ThreadRuntimeStatus } from '../codex/event-hub.js'
import type { GuestService } from '../guest-service.js'
import type { WorkspaceService } from '../workspace.js'

export type CodexBridge = {
  get(
    userId: string,
    projectId: string,
    credentialId: string,
  ): Promise<{
    request(
      method: string,
      params?: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<unknown>
  }>
  getReady?: (userId: string) => Promise<{
    request(
      method: string,
      params?: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<unknown>
  }>
  enqueueTurn?: (
    userId: string,
    run: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs?: number,
    taskId?: string,
    scope?: string,
  ) => Promise<unknown>
  cancelQueuedTurn?: (userId: string, taskId?: string) => boolean
  respondToServerRequest?: (
    userId: string,
    threadId: string,
    requestId: number | string,
    result: unknown,
  ) => number | string | void
  getStatus?: (userId: string) => {
    status: string
    projectId: string | null
    activeCredentialId: string | null
    pendingCredentialId: string | null
    restartRequired: boolean
    activeTurns?: number
    error: string | null
    dangerousAccessConfirmed?: boolean
  }
  ensureThread?: (userId: string, threadId: string) => Promise<void>
  markThreadLoaded?: (userId: string, threadId: string) => void
  start?: (userId: string, projectId: string, credentialId: string) => Promise<unknown>
  restart?: (userId: string, projectId: string, credentialId: string) => Promise<unknown>
  markCredentialPending?: (userId: string, credentialId: string) => void
  markDangerousAccessConfirmed?: (userId: string) => void
  stop?: (userId: string) => Promise<void>
  events: {
    publish?: (userId: string, message: unknown) => Promise<void>
    latestEventId: (userId: string, threadId?: string) => number
    threadHistory?: (
      userId: string,
      threadId: string,
    ) => Promise<Array<{ id: number; message: NativeCodexMessage }>>
    isHealthy?: () => boolean
    threadRuntimeStatus?: (userId: string, threadId: string) => ThreadRuntimeStatus
    subscribe(
      userId: string,
      threadId: string | undefined,
      afterId: number,
      listener: (event: { id: number; message: Record<string, unknown> }) => void,
    ): () => unknown
  }
}

export type AppDependencies = {
  auth: Auth
  workspace: WorkspaceService & { hasOwner?: () => Promise<boolean> }
  codex: CodexBridge
  guest?: GuestService
}

export type RouteContext = {
  config: ServerConfig
  dependencies: AppDependencies
}
