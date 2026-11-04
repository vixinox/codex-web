import { describe, expect, it } from 'vitest'
import { parseOwnerStreamEvent } from '@codex-web/protocol/owner'
import { ownerDomainEventFixtures } from '../../../../../protocol/fixtures/owner-domain-events'
import { parseThreadSnapshot } from '../domain/owner-thread-adapter'
import {
  applyCodexNotification,
  applyHistoryEvents,
  createCodexThreadState,
  domainEventToCodexNotification,
} from './codex-thread'

describe('Owner domain event contract to Codex reducer', () => {
  it('uses the same validated events for live and history and produces equivalent state', () => {
    const liveEvents = ownerDomainEventFixtures.map((event) => {
      const parsed = parseOwnerStreamEvent({
        cursor: { epoch: 'epoch-1', sequence: event.eventId },
        event,
      })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(parsed.error.message)
      return parsed.value.event
    })
    const snapshot = parseThreadSnapshot({
      thread: {
        id: 'thread-1',
        turns: [{ id: 'turn-1', status: 'completed', items: [] }],
      },
      eventCursor: { epoch: 'epoch-1', sequence: 11 },
      historyEvents: ownerDomainEventFixtures.map((event) => ({ id: event.eventId, event })),
    })
    const live = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
      null,
    )
    const history = createCodexThreadState(snapshot.thread, null)

    for (const event of liveEvents)
      applyCodexNotification(live, domainEventToCodexNotification(event), String(event.eventId))
    applyHistoryEvents(
      history,
      snapshot.historyEvents!.map(({ id, event }) => ({
        id,
        message: domainEventToCodexNotification(event),
      })),
    )

    expect(history.thread).toEqual(live.thread)
    expect(history.questionnaireSummaries).toEqual(live.questionnaireSummaries)
    expect(history.userInput).toEqual(live.userInput)
    expect(history.protocolErrors).toEqual(live.protocolErrors)
    expect(history.protocolErrors).toContain('Unmapped runtime event: future/notification')
    expect(JSON.stringify(history.protocolErrors)).not.toContain('safe-summary-only')
  })

  it('reports an unhandled supported type without exposing its payload', () => {
    const state = createCodexThreadState({ id: 'thread-1', turns: [] }, null)
    applyCodexNotification(
      state,
      domainEventToCodexNotification({
        ...ownerDomainEventFixtures[2]!,
        eventId: 12,
        type: 'codex.future/privateMethod',
        payload: { threadId: 'thread-1', token: 'must-not-display' },
      }),
      '12',
    )
    expect(state.protocolErrors).toEqual(['Unmapped Codex event: future/privateMethod'])
    expect(JSON.stringify(state.protocolErrors)).not.toContain('must-not-display')
  })
  it('keeps materialized plan/reasoning and lifecycle state authoritative over retained tail events', () => {
    const thread = {
      id: 'thread-1',
      status: { type: 'idle' },
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            { id: 'plan-1', type: 'plan', text: 'complete plan', status: 'completed' },
            { id: 'reason-1', type: 'reasoning', summary: ['complete summary'] },
          ],
        },
      ],
    }
    const state = createCodexThreadState(structuredClone(thread), null)
    const messages = [
      {
        method: 'item/plan/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'plan-1', delta: ' plan' },
      },
      {
        method: 'item/reasoning/summaryTextDelta',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'reason-1',
          delta: ' summary',
          summaryIndex: 0,
        },
      },
      {
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { id: 'plan-1', type: 'plan', text: '' },
        },
      },
      {
        method: 'thread/status/changed',
        params: { threadId: 'thread-1', status: { type: 'active' } },
      },
      {
        method: 'future/privateMethod',
        params: { threadId: 'thread-1', secret: 'must-not-display' },
      },
    ]
    const history = messages.map((message, index) => ({ id: index + 1, message }))
    applyHistoryEvents(state, history)
    applyHistoryEvents(state, history)
    expect(state.thread).toEqual(thread)
    expect(state.protocolErrors).toEqual(['Unmapped Codex event: future/privateMethod'])
    expect(JSON.stringify(state.protocolErrors)).not.toContain('must-not-display')
    // The same deltas still work in the live reducer.
    applyCodexNotification(state, messages[0]!)
    expect(state.thread.turns?.[0]?.items?.[0]?.text).toBe('complete plan plan')
  })
})
