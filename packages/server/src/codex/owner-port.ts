import type { RuntimeModel } from './model-catalog.js'
import type { EventHub } from './event-hub.js'
import type { RequestId } from './request-id.js'

export type CodexOwnerClient = {
  request(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
    onResponse?: () => void,
  ): Promise<unknown>
}

export type CodexOwnerStatus = {
  status: string
  projectId: string | null
  activeCredentialId: string | null
  pendingCredentialId: string | null
  restartRequired: boolean
  activeTurns?: number
  error: string | null
}

export type CodexOwnerEvents = Pick<
  EventHub,
  | 'latestEventId'
  | 'isCursorExpired'
  | 'subscribeFrom'
  | 'threadHistory'
  | 'isHealthy'
  | 'captureThreadSnapshot'
  | 'isCursorAhead'
  | 'subscribe'
>

/** Required capabilities consumed by Owner application modules. */
export type CodexOwnerPort = {
  modelCatalog(userId: string): Promise<RuntimeModel[]>
  get(userId: string, projectId: string, credentialId: string): Promise<CodexOwnerClient>
  getReady(userId: string): Promise<CodexOwnerClient>
  enqueueTurn(
    userId: string,
    run: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs?: number,
    taskId?: string,
    scope?: string,
  ): Promise<unknown>
  cancelQueuedTurn(userId: string, taskId?: string): boolean
  respondToServerRequest(
    userId: string,
    threadId: string,
    requestId: RequestId,
    result: unknown,
  ): number | string | void
  getStatus(userId: string): CodexOwnerStatus
  ensureThread(userId: string, threadId: string): Promise<void>
  markThreadLoaded(userId: string, threadId: string): void
  start(userId: string, projectId: string, credentialId: string): Promise<unknown>
  restart(userId: string, projectId: string, credentialId: string): Promise<unknown>
  markCredentialPending(userId: string, credentialId: string): void
  stop(userId: string): Promise<void>
  events: CodexOwnerEvents
}
