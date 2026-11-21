import {
  createConversationSnapshot,
  type ActivityId,
  type ConversationId,
  type ConversationSnapshot,
  type MessageId,
  type MessagePartId,
  type TurnId,
} from '@codex-web/conversation'
import { describe, expect, it } from 'vitest'
import { projectConversation } from './conversation-presentation'

const conversationId = 'thread-1' as ConversationId
const turnId = 'turn-1' as TurnId
const diff = '--- a/src/report.ts\n+++ b/src/summary.ts\n@@ -1 +1 @@\n-old\n+new'

function fixture(): ConversationSnapshot {
  return {
    ...createConversationSnapshot(conversationId, 17),
    turns: {
      [turnId]: {
        id: turnId,
        status: 'completed',
        messageIds: [],
        activityIds: [],
        itemOrder: [],
      },
    },
  }
}

describe('Conversation presentation', () => {
  it('projects Composer usage fields and preserves an unknown context window', () => {
    const last = {
      inputTokens: 20,
      cachedInputTokens: 5,
      outputTokens: 9,
      reasoningOutputTokens: 3,
      totalTokens: 29,
    }
    const tokenUsage = {
      last,
      total: { ...last, inputTokens: 40, totalTokens: 49, cacheWriteInputTokens: 7 },
      modelContextWindow: null,
    }
    expect(projectConversation({ ...fixture(), tokenUsage }, null).tokenUsage).toEqual({
      modelContextWindow: null,
      last: { inputTokens: 20, outputTokens: 9, reasoningOutputTokens: 3, totalTokens: 29 },
      total: { inputTokens: 40, outputTokens: 9, reasoningOutputTokens: 3, totalTokens: 49 },
    })
  })

  it('preserves interleaved messages, final answer, command, file and plan details', () => {
    const state = fixture()
    const turn = state.turns[turnId]!
    turn.diff = diff
    turn.durationMs = 1150
    turn.plan = {
      steps: [{ step: 'Update the report', status: 'completed' }],
      explanation: 'One file needs an update.',
    }
    for (const [index, id] of ['user', 'intro', 'progress', 'answer', 'follow-up'].entries()) {
      const messageId = id as MessageId
      state.messages[id] = {
        id: messageId,
        turnId,
        role: index === 0 ? 'user' : 'assistant',
        status: 'completed',
        ...(id === 'answer' ? { phase: 'final_answer' } : {}),
        parts: [{ id: `${id}:text` as MessagePartId, type: 'text', text: id }],
      }
      turn.messageIds.push(messageId)
    }
    for (const id of ['check', 'edit', 'verify', 'plan']) {
      const activityId = id as ActivityId
      state.activities[id] = {
        id: activityId,
        turnId,
        kind: id === 'edit' ? 'fileChange' : id === 'plan' ? 'plan' : 'commandExecution',
        status: id === 'check' ? 'failed' : 'completed',
        ...(id === 'edit'
          ? {
              changes: [
                { path: 'src/report.ts', kind: 'update', movePath: 'src/summary.ts', diff },
              ],
            }
          : id === 'plan'
            ? { output: 'Update the report and verify the result.' }
            : {
                command: 'pnpm report',
                commandStatus: id === 'check' ? 'failed' : 'completed',
                exitCode: id === 'check' ? 1 : 0,
                durationMs: id === 'check' ? 120 : 80,
                output: id === 'check' ? 'Report is stale.' : 'Report is current.',
              }),
      }
      turn.activityIds.push(activityId)
    }
    turn.itemOrder = [
      'user',
      'intro',
      'check',
      'progress',
      'edit',
      'verify',
      'plan',
      'answer',
      'follow-up',
    ].map((id) =>
      state.messages[id]
        ? { type: 'message', id: id as MessageId }
        : { type: 'activity', id: id as ActivityId },
    )
    const projected = projectConversation(state, null).turns[0]!
    expect(projected.blocks.map(({ id }) => id)).toEqual([
      'user',
      'intro',
      'activity-check',
      'progress',
      'activity-edit',
      'activity-verify',
      'answer',
      'follow-up',
    ])
    expect(projected.blocks).toMatchObject([
      { type: 'user' },
      { type: 'assistant' },
      {
        activities: [
          {
            command: 'pnpm report',
            commandStatus: 'failed',
            exitCode: 1,
            durationMs: 120,
            output: 'Report is stale.',
          },
        ],
      },
      { type: 'assistant' },
      {
        activities: [
          {
            changes: [{ path: 'src/report.ts', kind: 'update', movePath: 'src/summary.ts', diff }],
          },
        ],
      },
      { activities: [{ commandStatus: 'completed', exitCode: 0 }] },
      { final: true },
      { type: 'assistant' },
    ])
    expect(projected).toMatchObject({
      durationMs: 1150,
      plan: { ...turn.plan, text: 'Update the report and verify the result.', final: true },
    })
    expect(state.watermark).toBe(17)
  })

  it.each(['inProgress', 'completed', 'cancelled', 'failed'] as const)(
    'preserves %s compaction lifecycle',
    (status) => {
      const state = fixture()
      const id = 'compact-1' as ActivityId
      state.turns[turnId]!.status = status
      state.turns[turnId]!.activityIds = [id]
      state.activities[id] = { id, turnId, kind: 'contextCompaction', status }
      const projected = projectConversation(state, null).turns[0]!
      expect(projected.status).toBe(status === 'cancelled' ? 'interrupted' : status)
      expect(projected.blocks).toMatchObject([
        {
          type: 'article',
          kind: 'context-compaction',
          status: status === 'inProgress' ? 'running' : status,
        },
      ])
      expect(state.turns[turnId]!.activityIds).toEqual([id])
    },
  )

  it('projects pending questions and terminal summaries with original answers', () => {
    const state = fixture()
    const id = 'questionnaire' as import('@codex-web/conversation').InteractionId
    state.interactions[id] = {
      id,
      turnId,
      kind: 'userInput',
      status: 'pending',
      details: {
        kind: 'userInput',
        blocking: true,
        questions: [
          { id: 'choice', prompt: 'Which check?', options: [{ id: 'focused', label: 'Focused' }] },
          { id: 'secret', prompt: 'Secret?', isSecret: true },
        ],
      },
    }
    expect(projectConversation(state, null).userInput).toMatchObject({
      requestId: id,
      turnId,
      isBlocking: true,
      questions: [
        { id: 'choice', question: 'Which check?', options: [{ label: 'Focused' }] },
        { isSecret: true },
      ],
    })
    state.interactions[id] = {
      ...state.interactions[id]!,
      status: 'resolved',
      outcome: { kind: 'answers', answers: { choice: ['Focused'], secret: ['must-not-display'] } },
    }
    const projected = projectConversation(state, null)
    expect(projected.userInput).toBeUndefined()
    expect(projected.turns[0]?.questionnaire).toMatchObject({
      requestId: id,
      questionCount: 2,
      questions: [{ answers: ['Focused'] }, { answers: ['must-not-display'] }],
    })
    expect(JSON.stringify(projected)).toContain('must-not-display')
  })

  it('preserves interrupted output, timestamps and a fallback aggregated file diff', () => {
    const state = fixture()
    const id = 'reply' as MessageId
    const turn = state.turns[turnId]!
    Object.assign(turn, {
      status: 'cancelled',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:01Z',
      durationMs: 1000,
      diff,
    })
    turn.messageIds = [id]
    state.messages[id] = {
      id,
      turnId,
      role: 'assistant',
      status: 'interrupted',
      parts: [{ id: 'reply:text' as MessagePartId, type: 'text', text: 'Partial output' }],
    }
    const projected = projectConversation(state, null).turns[0]!
    expect(projected).toMatchObject({
      status: 'interrupted',
      startedAt: 1767225600000,
      completedAt: 1767225601000,
      durationMs: 1000,
    })
    expect(projected.blocks).toMatchObject([
      { type: 'assistant', text: 'Partial output' },
      { type: 'activity', kind: 'file', activities: [{ aggregatedDiff: diff }] },
    ])
  })
})
