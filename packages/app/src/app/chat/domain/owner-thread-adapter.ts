import type {
  ConversationId,
  InteractionId,
  MessagePartId,
  TurnId,
  ConversationCommand,
} from '@codex-web/conversation'
import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
import type {
  StartedThread,
  StartedTurn,
  StartThreadInput,
  ThreadClient,
  ThreadSummary,
} from '@/lib/bridge/interfaces/thread'

type OwnerTurnStart = Extract<ConversationCommand, { type: 'turn.start' }> &
  Omit<StartThreadInput, 'text'>

export const ownerThreadDomainAdapter: ThreadClient = {
  async listThreads(projectId) {
    const value = await getOwnerBridge().request<unknown>(
      'threads.list',
      projectId ? { projectId } : {},
    )
    const threads = isRecord(value) && Array.isArray(value.data) ? value.data : value
    return Array.isArray(threads) ? threads.filter(isThreadSummary) : []
  },
  async createThread(input, signal) {
    return getOwnerBridge().request<StartedThread>('threads.create', input, {
      signal,
      mutation: true,
    })
  },
  async startTurn(threadId, input, signal) {
    const { text, ...options } = input
    const command: OwnerTurnStart = {
      type: 'turn.start',
      conversationId: threadId as ConversationId,
      input: [{ type: 'text', id: 'user-text' as MessagePartId, text }],
      ...options,
    }
    return getOwnerBridge().request<StartedTurn>('conversation.command', command, {
      signal,
      mutation: true,
    })
  },
  async steerTurn(threadId, expectedTurnId, input) {
    return getOwnerBridge().request<StartedTurn>(
      'conversation.command',
      {
        type: 'turn.steer',
        conversationId: threadId,
        expectedTurnId,
        input: [{ type: 'text', id: 'user-text', text: input.text }],
        skills: input.skills,
      },
      { mutation: true },
    )
  },
  async cancelTurn(threadId, turnId) {
    const command: ConversationCommand = {
      type: 'turn.cancel',
      conversationId: threadId as ConversationId,
      turnId: turnId as TurnId,
    }
    await getOwnerBridge().request('conversation.command', command, { mutation: true })
  },
  async compactThread(threadId) {
    const command: ConversationCommand = {
      type: 'conversation.compact',
      conversationId: threadId as ConversationId,
    }
    await getOwnerBridge().request('conversation.command', command, { mutation: true })
  },
  async answerUserInput(threadId, interactionId, answers) {
    const command: ConversationCommand = {
      type: 'interaction.respond',
      conversationId: threadId as ConversationId,
      interactionId: interactionId as InteractionId,
      outcome: {
        kind: 'answers',
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, answer]) => [id, answer.answers]),
        ),
      },
    }
    await getOwnerBridge().request('conversation.command', command, { mutation: true })
  },
}

function isThreadSummary(value: unknown): value is ThreadSummary {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'number'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
