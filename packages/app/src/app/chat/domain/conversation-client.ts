import type {
  ConversationChange,
  ConversationCommand,
  ConversationId,
  ConversationSnapshot,
} from '@codex-web/conversation'

export type ConversationTarget = {
  projectId: string | null
  conversationId: ConversationId
}

export type ConversationObserver = {
  syncStatus?(ready: boolean): void
  replaceSnapshot(snapshot: ConversationSnapshot): void
  applyChange(change: ConversationChange): void
  transportError(error: unknown): void
}

export interface ConversationClient {
  watch(
    target: ConversationTarget,
    observer: ConversationObserver,
    signal: AbortSignal,
  ): Promise<void>
  send(command: ConversationCommand, signal?: AbortSignal): Promise<void>
}
