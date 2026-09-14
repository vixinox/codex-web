import type { ChatEffort, ChatModel } from './composer-types'

export type ChatPresentationStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted'

export type ChatActivityKind =
  | 'plan'
  | 'command'
  | 'search'
  | 'file'
  | 'reasoning'
  | 'tool'
  | 'agent'
  | 'image'
  | 'system'

export type ChatSearchAction =
  | { type: 'search'; query?: string; queries?: string[] }
  | { type: 'openPage'; url?: string }
  | { type: 'findInPage'; url?: string; pattern?: string }

export type ChatUserContent =
  | { type: 'text'; text: string }
  | { type: 'attachment'; kind: 'image' | 'audio'; label: string }
  | { type: 'reference'; kind: 'skill' | 'mention'; label: string }

export type ChatActivity = {
  id: string
  sourceType: string
  kind: ChatActivityKind
  title: string
  detail?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  command?: string
  commandStatus?: 'completed' | 'failed' | 'declined' | 'interrupted'
  exitCode?: number
  durationMs?: number
  output?: string
  aggregatedDiff?: string
  meta?: string
  searchAction?: ChatSearchAction
  truncated?: boolean
  changes?: ChatFileChange[]
}

export type ChatPlanStep = { step: string; status: 'pending' | 'inProgress' | 'completed' }
export type ChatFileChange = { path: string; kind: string; movePath?: string; diff?: string }

export type ChatBlock =
  | { id: string; type: 'user'; content: ChatUserContent[] }
  | { id: string; type: 'assistant'; text: string; final?: boolean }
  | { id: string; type: 'activity'; kind: ChatActivityKind; activities: ChatActivity[] }
  | {
      id: string
      type: 'article'
      kind: 'context-compaction'
      title: string
      status: 'running' | 'completed' | 'cancelled' | 'failed'
    }
  | { id: string; type: 'error'; message: string }

export type ChatTurnPresentation = {
  id: string
  presentationId?: string
  status: ChatPresentationStatus
  blocks: ChatBlock[]
  questionnaire?: ChatQuestionnaireSummary
  startedAt?: number
  completedAt?: number
  durationMs?: number
  error?: { message: string; details?: string }
  plan?: ChatPlanPresentation
}

export type ChatQuestionnaireSummary = {
  /** Bridge request identity used to reconcile persisted answered/resolved event ordering. */
  requestId?: number | string
  questionCount: number
  questions: { id?: string; question: string; answers: string[] }[]
}

export type ChatPendingTurn = {
  clientTurnId: string
  optimisticThreadId: string
  nativeThreadId?: string
  nativeTurnId?: string
  projectId: string | null
  text: string
  content?: ChatUserContent[]
  startedAt: number
}

export type ChatPlanPresentation = {
  steps: ChatPlanStep[]
  diffStats: { files: number; additions: number; deletions: number }
  text?: string
  explanation?: string
  final: boolean
}

export type ChatThreadPresentation = {
  id: string
  projectId: string | null
  title: string
  modelProvider?: string
  model?: ChatModel
  reasoningEffort?: ChatEffort
  updatedAt?: number | null
  turns: ChatTurnPresentation[]
  isBusy: boolean
  tokenUsage?: ChatTokenUsage
  userInput?: ChatUserInputRequest
}

export type ChatUserInputQuestion = {
  id: string
  header: string
  question: string
  options?: { label: string; description: string }[] | null
  isSecret?: boolean
  isOther?: boolean
}

export type ChatUserInputRequest = {
  requestId: number | string
  turnId: string
  itemId: string
  questions: ChatUserInputQuestion[]
  isBlocking: boolean
}

export type ChatTokenUsage = {
  modelContextWindow: number | null
  last: {
    inputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
  }
  total: {
    inputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
  }
}
