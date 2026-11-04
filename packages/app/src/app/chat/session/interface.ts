import type { Snapshot } from 'valtio'

import type { ComposerHost, ComposerRuntimeAdapter } from './adapters/composer-adapter'
import type { ComposerCapabilities } from '@/app/chat/composer/model/composer-capabilities'
import type { ThreadComposerSelection } from '@/app/chat/composer/state/model-selection-sync'
import type {
  ComposerActions,
  ComposerViewModel,
  ThreadComposerSlotModel,
} from '@/app/chat/model/composer-types'
import type {
  ChatPendingTurn,
  ChatThreadPresentation,
  ChatTokenUsage,
  ChatTurnPresentation,
} from '@/app/chat/model/types'
import type { CodexHistoryEvent, CodexNotification } from '@/app/chat/native/codex-thread'
import type { CodexThread } from '@/lib/protocol/protocol'

export type ThreadLifecycleMethod = 'thread/archived' | 'thread/deleted' | 'thread/closed'
export type ThreadLifecycleHandler = (method: ThreadLifecycleMethod) => void

/** Mutable presentation state owned by the native-reducer-backed session store. */
export type ThreadSessionPresentation = Omit<ChatThreadPresentation, 'turns'> & {
  status: 'idle' | 'ready' | 'error'
  error?: string
  turnOrder: string[]
  turnsById: Record<string, ChatTurnPresentation>
  hasCompactionTurn: boolean
  latestUserBlockId: string | null
  inputErrors: string[]
}

export type ThreadSessionSnapshot = Snapshot<ThreadSessionPresentation>

/** The reducer session interface used by the detail controller and transcript assets. */
export type ThreadSession = {
  readonly key: string
  readonly state: ThreadSessionPresentation
  hydrate(
    thread: CodexThread,
    eventCursor: number,
    historyEvents?: readonly CodexHistoryEvent[],
  ): { replayAfterId: number; sparseTurnIds: Set<string> }
  interruptUserInput(): void
  applyEvent(notification: CodexNotification, eventId?: string | number): void
  hasActiveFollowedTurn(turnId: string | null): boolean
  setError(message: string): void
  dispose(): void
}

export type ChatSessionModel =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      session: ThreadSession
      thread: ChatThreadPresentation
    }

/** Stable controller result for loading, following, and answering a native Thread. */
export type ChatSession = {
  model: ChatSessionModel
  eventError: string | null
  retry(): void
  followTurn(): void
  answerUserInput(answers: Record<string, { answers: string[] }>): Promise<void>
  cancelUserInput(): Promise<void>
  inputErrors: readonly string[]
}

export type ComposerSessionOptions = {
  userId: string
  adapter: ComposerRuntimeAdapter
  host: ComposerHost
  /** Screen-level override of the adapter capability config, e.g. New Chat. */
  capabilities?: ComposerCapabilities
  runtimeReady: boolean
  runtimeStatus?: string
  working: boolean
  tokenUsage?: ChatTokenUsage
  threadSelection?: ThreadComposerSelection
  onPendingChange?: (pending: ChatPendingTurn | null, key: string | null) => void
  onThreadCreationStart?: (projectId: string | null, title: string) => string
  onThreadCreationFailed?: (placeholderId: string, message: string) => void
  onThreadCreationResolved?: (
    placeholderId: string,
    projectId: string | null,
    threadId: string,
  ) => void
}

/** The UI-facing composer state and its complete action surface. */
export type ComposerSession = {
  scope: string
  viewModel: ComposerViewModel
  actions: ComposerActions
  capabilities: ComposerCapabilities
  retryState: { attempt: number; maxAttempts: number } | null
  compacting: boolean
}

export type ThreadPageTarget = { projectId: string | null; threadId: string | null }

export type ThreadComposerHost = {
  target: ThreadPageTarget
  followTurn(turnId: string): void
  retry(): void
  navigateToThread(input: { projectId: string | null; threadId: string; turnId: string }): void
  onTurnAccepted(input: { projectId: string | null; threadId: string; turnId: string }): void
  activeTurnId?: string | null
  onUnavailable?: () => void
}

export type ThreadComposerSessionOptions = {
  userId: string
  host: ThreadComposerHost
  runtimeReady: boolean
  runtimeStatus?: string
  working: boolean
  tokenUsage?: ComposerViewModel['tokenUsage']
  threadSelection?: ThreadComposerSelection
  onPendingChange?: (pending: ChatPendingTurn | null, key: string | null) => void
  onThreadCreationStart?: (projectId: string | null, title: string) => string
  onThreadCreationFailed?: (placeholderId: string, message: string) => void
  onThreadCreationResolved?: (
    placeholderId: string,
    projectId: string | null,
    threadId: string,
  ) => void
  adapter?: ComposerRuntimeAdapter
  capabilities?: ComposerCapabilities
}

export type ThreadPageModel =
  | { status: 'empty'; title: string }
  | { status: 'starting'; thread: ChatThreadPresentation }
  | { status: 'ready'; thread: ChatThreadPresentation }
  | Exclude<ChatSessionModel, { status: 'ready' }>

export type ThreadPageSession = {
  model: ThreadPageModel
  eventError: string | null
  session?: ThreadSession
  compacting: boolean
  detail: ChatSession
  composer: ComposerViewModel
  capabilities: ComposerCapabilities
  composerSlot: ThreadComposerSlotModel
  actions: ComposerActions & {
    retry(): void
    answerUserInput: ChatSession['answerUserInput']
    cancelUserInput: ChatSession['cancelUserInput']
  }
  lockEpoch: number
  retryState: ComposerSession['retryState']
  inputErrors: readonly string[]
  pendingAccepted: boolean
}
