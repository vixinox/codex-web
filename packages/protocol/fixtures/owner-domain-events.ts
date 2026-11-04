import type { DomainEventEnvelope } from '../src/owner/index.js'

const createdAt = '2026-01-01T00:00:00.000Z'

function event(
  eventId: number,
  type: string,
  payload: Record<string, unknown>,
  ids: Pick<DomainEventEnvelope, 'threadId' | 'turnId' | 'itemId' | 'requestId'> = {},
): DomainEventEnvelope {
  return {
    eventId,
    type,
    runtime: 'codex',
    ...ids,
    createdAt,
    payload,
  }
}

export const ownerDomainEventFixtures = [
  event(
    1,
    'codex.turn/started',
    { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', items: [] } },
    { threadId: 'thread-1', turnId: 'turn-1' },
  ),
  event(
    2,
    'codex.item/started',
    {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'assistant-1', type: 'agentMessage' },
    },
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'assistant-1' },
  ),
  event(
    3,
    'codex.item/agentMessage/delta',
    {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      delta: 'hello',
    },
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'assistant-1' },
  ),
  event(
    4,
    'codex.item/started',
    {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'command-1', type: 'commandExecution', status: 'inProgress', command: 'dir' },
    },
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1' },
  ),
  event(
    5,
    'codex.item/commandExecution/outputDelta',
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: 'ok' },
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1' },
  ),
  event(
    6,
    'codex.item/commandExecution/requestApproval',
    { threadId: 'thread-1', turnId: 'turn-1', requestId: 'approval-1' },
    { threadId: 'thread-1', turnId: 'turn-1', requestId: 'approval-1' },
  ),
  event(
    7,
    'codex.item/tool/requestUserInput',
    {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'question-1',
      requestId: 'input-1',
      isBlocking: true,
      questions: [{ id: 'q1', question: 'Choose' }],
    },
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'question-1', requestId: 'input-1' },
  ),
  event(
    8,
    'codex.webcodex/userInput/answered',
    {
      threadId: 'thread-1',
      requestId: 'input-1',
      answers: { q1: { answers: ['first'] } },
    },
    { threadId: 'thread-1', requestId: 'input-1' },
  ),
  event(
    9,
    'codex.thread/tokenUsage/updated',
    {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: {
        modelContextWindow: 1000,
        last: { inputTokens: 2, outputTokens: 3, reasoningOutputTokens: 0, totalTokens: 5 },
        total: { inputTokens: 2, outputTokens: 3, reasoningOutputTokens: 0, totalTokens: 5 },
      },
    },
    { threadId: 'thread-1', turnId: 'turn-1' },
  ),
  event(
    10,
    'codex.turn/completed',
    {
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        status: 'completed',
        items: [
          { id: 'assistant-1', type: 'agentMessage', text: 'hello' },
          {
            id: 'command-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'dir',
            aggregatedOutput: 'ok',
          },
        ],
      },
    },
    { threadId: 'thread-1', turnId: 'turn-1' },
  ),
  event(
    11,
    'runtime.extension',
    { method: 'future/notification', params: { detail: 'safe-summary-only' } },
    { threadId: 'thread-1' },
  ),
] satisfies DomainEventEnvelope[]

export const ownerDomainEventProducerFixture = {
  event: ownerDomainEventFixtures[2],
  notification: {
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      delta: 'hello',
    },
  },
}
