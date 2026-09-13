import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  answerUserInput: vi.fn(),
  cancelTurn: vi.fn(),
  fetchThread: vi.fn(),
  fetchThreadRuntimeStatus: vi.fn(),
  subscribeToEvents: vi.fn(),
}))

vi.mock('@/lib/bridge/http/threads', () => bridge)
vi.mock('@/lib/bridge/events/event-source', () => ({
  subscribeToEvents: bridge.subscribeToEvents,
}))

import {
  applyCodexNotification,
  applyHistoryEvents,
  createCodexThreadState,
  mergeCodexThreads,
  reduceCodexNotification,
} from '../native/codex-thread'
import { toChatThreadPresentation } from '../projection/thread-presentation'
import { ownerThreadClient } from '@/lib/bridge/thread-adapters'
import { useThreadDetailController } from './use-thread-detail-controller'

const historyEvent = (id: number, method: string, params: Record<string, unknown>) => ({
  id,
  message: { method, params },
})

describe('Thread detail event synchronization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('recovers an SSE connection through status before hydrating only when needed', async () => {
    bridge.fetchThread.mockResolvedValue({
      thread: { id: 'thread-1', turns: [] },
      eventCursor: 2,
    })
    bridge.fetchThreadRuntimeStatus.mockResolvedValue({
      threadId: 'thread-1',
      projectId: 'project-1',
      status: 'idle',
      eventCursor: 2,
      activeTurnId: null,
    })
    let onError: (() => void) | undefined
    bridge.subscribeToEvents.mockImplementation(({ onError: error }) => {
      onError = error
      return () => undefined
    })
    const rendered = renderHook(() =>
      useThreadDetailController(ownerThreadClient, 'project-1', 'thread-1'),
    )
    await waitFor(() => expect(bridge.subscribeToEvents).toHaveBeenCalledTimes(1))
    act(() => onError?.())
    await waitFor(() => expect(bridge.fetchThreadRuntimeStatus).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    })
    expect(bridge.fetchThread).toHaveBeenCalledTimes(1)
    rendered.unmount()
  })

  it('starts the detail stream after the snapshot with its event cursor', async () => {
    bridge.fetchThread.mockResolvedValue({
      thread: { id: 'thread-1', turns: [] },
      eventCursor: 9,
    })
    bridge.subscribeToEvents.mockReturnValue(() => undefined)

    renderHook(() => useThreadDetailController(ownerThreadClient, 'project-1', 'thread-1'))
    await act(async () => undefined)

    expect(bridge.subscribeToEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/events?threadId=thread-1&afterId=9',
      }),
    )
  })

  it('forwards lifecycle events through the detail stream callback', async () => {
    bridge.fetchThread.mockResolvedValue({
      thread: { id: 'thread-1', turns: [] },
      eventCursor: 2,
    })
    let onEvent: ((event: Event) => void) | undefined
    bridge.subscribeToEvents.mockImplementation(({ onEvent: receive }) => {
      onEvent = receive
      return () => undefined
    })
    const onThreadLifecycle = vi.fn()
    renderHook(() =>
      useThreadDetailController(
        ownerThreadClient,
        'project-1',
        'thread-1',
        undefined,
        onThreadLifecycle,
      ),
    )
    await act(async () => undefined)

    act(() => {
      const event = {
        lastEventId: '3',
        data: JSON.stringify({ method: 'thread/closed', params: { threadId: 'thread-1' } }),
      } as MessageEvent
      onEvent?.(event)
      onEvent?.(event)
    })
    expect(onThreadLifecycle).toHaveBeenCalledWith('thread/closed')
    expect(onThreadLifecycle).toHaveBeenCalledTimes(1)
  })

  it('ignores events delivered after the Thread effect has been cleaned up', async () => {
    bridge.fetchThread.mockResolvedValue({
      thread: { id: 'thread-1', turns: [] },
      eventCursor: 2,
    })
    let onEvent: ((event: Event) => void) | undefined
    bridge.subscribeToEvents.mockImplementation(({ onEvent: receive }) => {
      onEvent = receive
      return () => undefined
    })
    const onThreadLifecycle = vi.fn()
    const rendered = renderHook(() =>
      useThreadDetailController(
        ownerThreadClient,
        'project-1',
        'thread-1',
        undefined,
        onThreadLifecycle,
      ),
    )
    await act(async () => undefined)

    rendered.unmount()
    onEvent?.({
      lastEventId: '3',
      data: JSON.stringify({ method: 'thread/closed', params: { threadId: 'thread-1' } }),
    } as MessageEvent)

    expect(onThreadLifecycle).not.toHaveBeenCalled()
  })

  it('retains streamed items when a followed turn refreshes from a sparse snapshot', async () => {
    bridge.fetchThread.mockReset()
    bridge.subscribeToEvents.mockReset()
    bridge.fetchThread
      .mockResolvedValueOnce({
        thread: { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
        eventCursor: 1,
      })
      .mockResolvedValueOnce({
        thread: { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
        eventCursor: 2,
      })
    let onEvent: ((event: Event) => void) | undefined
    bridge.subscribeToEvents.mockImplementation(({ onEvent: receive }) => {
      onEvent = receive
      return () => undefined
    })

    const rendered = renderHook(() =>
      useThreadDetailController(ownerThreadClient, 'project-1', 'thread-1'),
    )
    await waitFor(() => expect(bridge.subscribeToEvents).toHaveBeenCalledTimes(1))
    act(() => {
      onEvent?.({
        lastEventId: '2',
        data: JSON.stringify({
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'message-1',
            delta: 'streamed',
          },
        }),
      } as MessageEvent)
    })

    act(() => rendered.result.current.followTurn())
    await waitFor(() =>
      expect(rendered.result.current.model).toMatchObject({
        status: 'ready',
        thread: {
          turns: [
            {
              status: 'completed',
              blocks: [{ id: 'message-1', type: 'assistant', text: 'streamed' }],
            },
          ],
        },
      }),
    )
    expect(bridge.fetchThread).toHaveBeenCalledTimes(2)
  })

  it('hydrates an active sparse turn from retained events after leaving and re-entering', async () => {
    bridge.fetchThread.mockReset()
    bridge.subscribeToEvents.mockReset()
    bridge.fetchThread
      .mockResolvedValueOnce({
        thread: { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
        eventCursor: 0,
      })
      .mockResolvedValueOnce({
        thread: { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
        eventCursor: 2,
      })
    const subscriptions: Array<(event: Event) => void> = []
    bridge.subscribeToEvents.mockImplementation(({ onEvent: receive }) => {
      subscriptions.push(receive)
      return () => undefined
    })

    const first = renderHook(() =>
      useThreadDetailController(ownerThreadClient, 'project-1', 'thread-1'),
    )
    await waitFor(() => expect(subscriptions).toHaveLength(1))
    act(() => {
      subscriptions[0]?.({
        lastEventId: '1',
        data: JSON.stringify({
          method: 'item/started',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: { id: 'command-1', type: 'commandExecution', command: 'dir' },
          },
        }),
      } as MessageEvent)
      subscriptions[0]?.({
        lastEventId: '2',
        data: JSON.stringify({
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'Done.' },
        }),
      } as MessageEvent)
    })
    first.unmount()

    const second = renderHook(() =>
      useThreadDetailController(ownerThreadClient, 'project-1', 'thread-1'),
    )
    await waitFor(() => expect(subscriptions).toHaveLength(2))
    expect(bridge.subscribeToEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: '/api/events?threadId=thread-1&afterId=0' }),
    )
    act(() => {
      subscriptions[1]?.({
        lastEventId: '1',
        data: JSON.stringify({
          method: 'item/started',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: { id: 'command-1', type: 'commandExecution', command: 'dir' },
          },
        }),
      } as MessageEvent)
      subscriptions[1]?.({
        lastEventId: '2',
        data: JSON.stringify({
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'Done.' },
        }),
      } as MessageEvent)
    })

    await waitFor(() =>
      expect(second.result.current.model).toMatchObject({
        status: 'ready',
        thread: {
          turns: [
            {
              blocks: [
                expect.objectContaining({ type: 'activity', kind: 'command' }),
                { id: 'message-1', type: 'assistant', text: 'Done.' },
              ],
            },
          ],
        },
      }),
    )
  })

  it('interrupts a pending questionnaire and keeps its unanswered summary in the model', async () => {
    bridge.fetchThread.mockReset()
    bridge.subscribeToEvents.mockReset()
    bridge.cancelTurn.mockReset().mockResolvedValue(undefined)
    bridge.fetchThread.mockResolvedValue({
      thread: { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      eventCursor: 1,
    })
    let onEvent: ((event: Event) => void) | undefined
    bridge.subscribeToEvents.mockImplementation(({ onEvent: receive }) => {
      onEvent = receive
      return () => undefined
    })
    const rendered = renderHook(() =>
      useThreadDetailController(ownerThreadClient, 'project-1', 'thread-1'),
    )
    await waitFor(() => expect(bridge.subscribeToEvents).toHaveBeenCalledTimes(1))
    act(() => {
      onEvent?.({
        lastEventId: '2',
        data: JSON.stringify({
          method: 'item/tool/requestUserInput',
          id: 42,
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'question-1',
            isBlocking: true,
            questions: [{ id: 'one', header: 'One', question: 'What should happen?', options: [] }],
          },
        }),
      } as MessageEvent)
    })
    await waitFor(() =>
      expect(rendered.result.current.model).toMatchObject({
        status: 'ready',
        thread: { userInput: { requestId: 42 } },
      }),
    )
    await act(async () => {
      await rendered.result.current.cancelUserInput()
    })
    expect(bridge.cancelTurn).toHaveBeenCalledWith('thread-1', 'turn-1')
    expect(rendered.result.current.model).toMatchObject({
      status: 'ready',
      thread: {
        turns: [
          {
            status: 'interrupted',
            questionnaire: { questionCount: 1, questions: [{ answers: [] }] },
          },
        ],
      },
    })
  })
})

describe('Codex native thread reducer', () => {
  it('captures and resolves a requestUserInput prompt', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const pending = reduceCodexNotification(state, {
      method: 'item/tool/requestUserInput',
      id: 42,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        isBlocking: true,
        questions: [{ id: 'choice', header: 'Choice', question: 'Pick one', options: [] }],
      },
    })
    expect(toChatThreadPresentation(pending).userInput).toMatchObject({
      requestId: 42,
      turnId: 'turn-1',
    })
    const resolved = reduceCodexNotification(pending, {
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-1', requestId: 42 },
    })
    expect(toChatThreadPresentation(resolved).userInput).toBeUndefined()
    expect(toChatThreadPresentation(resolved).turns[0]?.questionnaire).toMatchObject({
      requestId: 42,
      questionCount: 1,
      questions: [{ id: 'choice', question: 'Pick one', answers: [] }],
    })
  })

  it('replays persisted questionnaire answers even when resolved arrives first', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
      null,
    )
    applyHistoryEvents(state, [
      historyEvent(20, 'item/tool/requestUserInput', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        requestId: 42,
        questions: [{ id: 'choice', question: 'Pick one', options: [] }],
      }),
      historyEvent(21, 'serverRequest/resolved', {
        threadId: 'thread-1',
        requestId: 42,
      }),
      historyEvent(22, 'webcodex/userInput/answered', {
        threadId: 'thread-1',
        requestId: 42,
        answers: { choice: { answers: ['First'] } },
      }),
    ])

    const presentation = toChatThreadPresentation(state)
    expect(presentation.userInput).toBeUndefined()
    expect(presentation.turns[0]?.questionnaire).toMatchObject({
      requestId: 42,
      questions: [{ id: 'choice', question: 'Pick one', answers: ['First'] }],
    })
  })

  it('accepts legacy requestUserInput payloads without isBlocking', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const pending = reduceCodexNotification(state, {
      method: 'item/tool/requestUserInput',
      id: 43,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-2',
        questions: [{ id: 'choice', question: 'Pick one', options: null }],
      },
    })
    expect(toChatThreadPresentation(pending).userInput).toMatchObject({
      requestId: 43,
      isBlocking: true,
      questions: [{ id: 'choice', header: 'choice' }],
    })
  })
  it('preserves an official turn error and its upstream details', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const next = reduceCodexNotification(state, {
      method: 'error',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        error: {
          message: 'Connection failed',
          codexErrorInfo: { httpStatusCode: 503 },
          additionalDetails: 'Upstream unavailable',
        },
      },
    })
    expect(toChatThreadPresentation(next).turns[0]?.error).toEqual({
      message: 'Connection failed',
      details: 'Upstream unavailable · HTTP 503',
    })
  })

  it('stores thread token usage updates for context presentation', () => {
    const state = createCodexThreadState({ id: 'thread-1', turns: [] }, null)
    const next = reduceCodexNotification(state, {
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          modelContextWindow: 1000,
          last: { inputTokens: 10, outputTokens: 5, reasoningOutputTokens: 2, totalTokens: 15 },
          total: {
            inputTokens: 100,
            outputTokens: 50,
            reasoningOutputTokens: 20,
            totalTokens: 150,
          },
        },
      },
    })
    expect(next.protocolErrors).toEqual([])
    expect(toChatThreadPresentation(next).tokenUsage).toMatchObject({
      modelContextWindow: 1000,
      total: { totalTokens: 150 },
    })
  })

  it('stores token usage carried by completed and failed turns without accumulating it', () => {
    const tokenUsage = {
      modelContextWindow: 1000,
      last: { inputTokens: 10, outputTokens: 5, reasoningOutputTokens: 2, totalTokens: 15 },
      total: { inputTokens: 100, outputTokens: 50, reasoningOutputTokens: 20, totalTokens: 150 },
    }
    let state = createCodexThreadState({ id: 'thread-1', turns: [] }, null)
    state = reduceCodexNotification(state, {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', items: [] },
        tokenUsage,
      },
    })
    state = reduceCodexNotification(state, {
      method: 'turn/failed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-2', status: 'failed', items: [] },
        tokenUsage,
      },
    })

    expect(toChatThreadPresentation(state).tokenUsage).toEqual(tokenUsage)
  })

  it('applies partial Thread settings updates to presentation metadata', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        turns: [],
      },
      null,
    )
    const modelUpdated = reduceCodexNotification(state, {
      method: 'thread/settings/updated',
      params: { threadId: 'thread-1', model: 'gpt-5.6-terra' },
    })
    expect(toChatThreadPresentation(modelUpdated)).toMatchObject({
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
    })

    const effortUpdated = reduceCodexNotification(modelUpdated, {
      method: 'thread/settings/updated',
      params: { threadId: 'thread-1', reasoningEffort: 'high' },
    })
    expect(toChatThreadPresentation(effortUpdated)).toMatchObject({
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    })
  })

  it('uses item ids to merge a streamed assistant reply and its completed item', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const started = reduceCodexNotification(state, {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'message-1', type: 'agentMessage', text: '', phase: 'commentary' },
      },
    })
    const delta = reduceCodexNotification(started, {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'hello' },
    })
    const completed = reduceCodexNotification(delta, {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'message-1', type: 'agentMessage', text: 'hello world', phase: 'commentary' },
      },
    })
    expect(toChatThreadPresentation(completed).turns[0]?.blocks).toEqual([
      { id: 'message-1', type: 'assistant', text: 'hello world' },
    ])
  })

  it('keeps streamed activity and assistant items when the terminal turn payload is sparse', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const started = reduceCodexNotification(state, {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'command-1', type: 'commandExecution', status: 'inProgress', command: 'dir' },
      },
    })
    const output = reduceCodexNotification(started, {
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: 'file.txt' },
    })
    const assistant = reduceCodexNotification(output, {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'Done.' },
    })
    const completed = reduceCodexNotification(assistant, {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ id: 'message-1', type: 'agentMessage', text: 'Done.' }],
        },
      },
    })

    expect(toChatThreadPresentation(completed).turns[0]?.blocks).toEqual([
      {
        id: 'activity-command-1',
        type: 'activity',
        kind: 'command',
        activities: [
          {
            id: 'command-1',
            sourceType: 'commandExecution',
            kind: 'command',
            title: 'Ran command',
            status: 'running',
            command: 'dir',
            output: 'file.txt',
          },
        ],
      },
      { id: 'message-1', type: 'assistant', text: 'Done.' },
    ])
  })

  it('maps context compaction lifecycle items to running and completed articles', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const started = reduceCodexNotification(state, {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'compact-1', type: 'contextCompaction' },
      },
    })
    expect(toChatThreadPresentation(started).turns[0]?.blocks).toEqual([
      {
        id: 'compact-1',
        type: 'article',
        kind: 'context-compaction',
        title: 'Context compacting',
        status: 'running',
      },
    ])

    const completed = reduceCodexNotification(started, {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'compact-1', type: 'contextCompaction' },
      },
    })
    expect(toChatThreadPresentation(completed).turns[0]?.blocks).toEqual([
      {
        id: 'compact-1',
        type: 'article',
        kind: 'context-compaction',
        title: 'Context compacted',
        status: 'completed',
      },
    ])
  })

  it('creates an assistant item when delta arrives before item started', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const next = reduceCodexNotification(state, {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'hello' },
    })
    expect(next.protocolErrors).toEqual([])
    expect(toChatThreadPresentation(next).turns[0]?.blocks).toEqual([
      { id: 'message-1', type: 'assistant', text: 'hello' },
    ])
  })

  it('preserves streamed items when turn completion has an empty item list', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const streamed = reduceCodexNotification(state, {
      method: 'item/agentMessage/delta',
      params: { turnId: 'turn-1', itemId: 'message-1', delta: 'hello' },
    })
    const completed = reduceCodexNotification(streamed, {
      method: 'turn/completed',
      params: { turnId: 'turn-1', turn: { id: 'turn-1', status: 'completed', items: [] } },
    })
    expect(toChatThreadPresentation(completed).turns[0]?.blocks).toEqual([
      { id: 'message-1', type: 'assistant', text: 'hello' },
    ])
  })

  it('keeps a command lifecycle in one activity and appends output by item id', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const started = reduceCodexNotification(state, {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'command-1', type: 'commandExecution', status: 'inProgress', command: 'dir' },
      },
    })
    const output = reduceCodexNotification(started, {
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: 'file.txt' },
    })
    const completed = reduceCodexNotification(output, {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'command-1',
          type: 'commandExecution',
          status: 'completed',
          command: 'dir',
          aggregatedOutput: 'file.txt',
          durationMs: 42,
        },
      },
    })
    expect(toChatThreadPresentation(completed).turns[0]?.blocks).toMatchObject([
      {
        type: 'activity',
        activities: [
          {
            id: 'command-1',
            kind: 'command',
            title: 'Ran command',
            command: 'dir',
            durationMs: 42,
            status: 'completed',
            output: 'file.txt',
          },
        ],
      },
    ])
  })

  it('classifies final answers as summaries without replacing commentary', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                id: 'commentary',
                type: 'agentMessage',
                text: 'I will inspect.',
                phase: 'commentary',
              },
              { id: 'final', type: 'agentMessage', text: 'Done.', phase: 'final_answer' },
            ],
          },
        ],
      },
      null,
    )
    expect(toChatThreadPresentation(state).turns[0]?.blocks).toEqual([
      { id: 'commentary', type: 'assistant', text: 'I will inspect.' },
      { id: 'final', type: 'assistant', text: 'Done.', final: true },
    ])
  })

  it('preserves activity and summary blocks in native item order', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              { id: 'command-1', type: 'commandExecution', status: 'completed', command: 'dir' },
              { id: 'final', type: 'agentMessage', text: 'Done.', phase: 'final_answer' },
            ],
          },
        ],
      },
      null,
    )

    expect(toChatThreadPresentation(state).turns[0]?.blocks).toEqual([
      expect.objectContaining({ id: 'activity-command-1', type: 'activity', kind: 'command' }),
      { id: 'final', type: 'assistant', text: 'Done.', final: true },
    ])
  })

  it('keeps partial assistant output and duration for interrupted turns', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'interrupted',
            durationMs: 2_400,
            items: [{ id: 'message-1', type: 'agentMessage', text: 'Partial response' }],
          },
        ],
      },
      null,
    )

    expect(toChatThreadPresentation(state).turns[0]).toMatchObject({
      status: 'interrupted',
      durationMs: 2_400,
      blocks: [{ id: 'message-1', type: 'assistant', text: 'Partial response' }],
    })
  })

  it('merges snapshot fields while retaining streamed turns and items absent from the snapshot', () => {
    const current = {
      id: 'thread-1',
      name: 'Current title',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [{ id: 'message-1', type: 'agentMessage', text: 'streamed' }],
        },
        {
          id: 'turn-live',
          status: 'inProgress',
          items: [{ id: 'activity-1', type: 'commandExecution' }],
        },
      ],
    }
    const snapshot = {
      id: 'thread-1',
      name: 'Snapshot title',
      turns: [
        { id: 'turn-1', status: 'completed', items: [] },
        { id: 'turn-2', status: 'completed', items: [] },
      ],
    }

    const merged = mergeCodexThreads(current, snapshot)
    expect(merged.name).toBe('Snapshot title')
    expect(merged.turns).toEqual([
      {
        id: 'turn-1',
        status: 'completed',
        items: [{ id: 'message-1', type: 'agentMessage', text: 'streamed' }],
      },
      { id: 'turn-2', status: 'completed', items: [] },
      {
        id: 'turn-live',
        status: 'inProgress',
        items: [{ id: 'activity-1', type: 'commandExecution' }],
      },
    ])
  })

  it('renders persisted activity item types and preserves unknown native items', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              { id: 'agent-1', type: 'collabAgentToolCall', status: 'completed' },
              { id: 'agent-2', type: 'subAgentActivity', status: 'completed' },
              { id: 'unknown-1', type: 'futureActivity', status: 'completed' },
            ],
          },
        ],
      },
      null,
    )
    expect(toChatThreadPresentation(state).turns[0]?.blocks).toMatchObject([
      { type: 'activity', kind: 'agent' },
      { type: 'activity', kind: 'system' },
    ])
    expect(toChatThreadPresentation(state).turns[0]?.blocks).not.toContainEqual(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('renders Guest token limits as a deduplicated system activity', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'interrupted', items: [] }] },
      null,
    )
    const event = {
      method: 'webcodex/guest-token-limit',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        maxTokens: 128_000,
        actualTokens: 129_000,
      },
    }
    applyCodexNotification(state, event, 'guest-limit-1')
    applyCodexNotification(state, event, 'guest-limit-1')
    applyHistoryEvents(state, [historyEvent(2, event.method, event.params)])
    const blocks = toChatThreadPresentation(state).turns[0]?.blocks ?? []
    expect(blocks).toEqual([
      {
        id: 'activity-guest-token-limit:turn-1',
        type: 'activity',
        kind: 'system',
        activities: [
          expect.objectContaining({
            id: 'guest-token-limit:turn-1',
            sourceType: 'guestTurnLimit',
            kind: 'system',
            title: 'Guest turn token limit reached',
            detail: 'This turn reached the 128000 token limit and was stopped.',
          }),
        ],
      },
    ])
  })

  it('makes malformed and replayed events visible without duplicating text', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const invalid = reduceCodexNotification(
      state,
      { method: 'item/agentMessage/delta', params: { turnId: 'turn-1' } },
      '1',
    )
    const replayed = reduceCodexNotification(
      invalid,
      { method: 'item/agentMessage/delta', params: { turnId: 'turn-1' } },
      '1',
    )
    expect(replayed.protocolErrors).toHaveLength(1)
    expect(toChatThreadPresentation(replayed).turns[0]?.blocks.at(-1)).toMatchObject({
      type: 'error',
    })
  })

  it('reduces plan, diff, file patches, and tool progress while ignoring reasoning in presentation', () => {
    const state = createCodexThreadState(
      {
        id: 't',
        turns: [
          {
            id: 'u',
            status: 'inProgress',
            items: [
              { id: 'plan', type: 'plan', text: '' },
              { id: 'reason', type: 'reasoning', summary: [] },
              { id: 'file', type: 'fileChange', status: 'inProgress' },
              { id: 'tool', type: 'mcpToolCall', status: 'inProgress', tool: 'search' },
            ],
          },
        ],
      },
      null,
    )
    let next = reduceCodexNotification(state, {
      method: 'turn/plan/updated',
      params: {
        turnId: 'u',
        plan: [
          { step: 'Inspect', status: 'completed' },
          { step: 'Fix', status: 'inProgress' },
        ],
        explanation: 'Plan',
      },
    })
    next = reduceCodexNotification(next, {
      method: 'turn/diff/updated',
      params: { turnId: 'u', diff: '@@ diff' },
    })
    next = reduceCodexNotification(next, {
      method: 'item/fileChange/patchUpdated',
      params: {
        turnId: 'u',
        itemId: 'file',
        changes: [{ path: 'a.ts', kind: { type: 'update' }, diff: '+x' }],
      },
    })
    next = reduceCodexNotification(next, {
      method: 'item/reasoning/summaryTextDelta',
      params: { turnId: 'u', itemId: 'reason', summaryIndex: 0, delta: 'Thinking' },
    })
    next = reduceCodexNotification(next, {
      method: 'item/mcpToolCall/progress',
      params: { turnId: 'u', itemId: 'tool', message: 'Loading' },
    })
    const presentation = toChatThreadPresentation(next)
    const blocks = presentation.turns[0]?.blocks ?? []
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'activity', kind: 'file' }),
        expect.objectContaining({ type: 'activity', kind: 'tool' }),
      ]),
    )
    expect(presentation.turns[0]?.plan).toMatchObject({
      steps: [
        { step: 'Inspect', status: 'completed' },
        { step: 'Fix', status: 'inProgress' },
      ],
      diffStats: { files: 1, additions: 1, deletions: 0 },
    })
    expect(JSON.stringify(presentation.turns[0]?.plan)).toContain('Inspect')
    expect(JSON.stringify(blocks)).toContain('a.ts')
    expect(JSON.stringify(blocks)).toContain('Loading')
    expect(JSON.stringify(blocks)).toContain('Thinking')
    expect(JSON.stringify(blocks)).not.toContain('Turn diff')
    expect(JSON.stringify(blocks)).not.toContain('aggregatedDiff')
  })

  it('exposes the final plan result for terminal plan turns', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            plan: [{ step: 'Done', status: 'completed' }],
            items: [{ id: 'plan-1', type: 'plan', text: 'Done', status: 'completed' }],
          },
        ],
      },
      null,
    )
    const turn = toChatThreadPresentation(state).turns[0]
    expect(turn?.plan).toMatchObject({ text: 'Done', final: true })
    expect(turn?.blocks.some((block) => block.type === 'activity' && block.kind === 'plan')).toBe(
      false,
    )
  })

  it('does not offer execution for interrupted plan turns', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'interrupted',
            items: [{ id: 'plan-1', type: 'plan', text: 'Incomplete plan' }],
          },
        ],
      },
      null,
    )

    expect(toChatThreadPresentation(state).turns[0]?.plan).toMatchObject({ final: false })
  })

  it('uses the turn diff as a file activity fallback when item diffs are unavailable', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
            items: [
              {
                id: 'file-1',
                type: 'fileChange',
                status: 'completed',
                changes: [{ path: 'a.ts', kind: { type: 'update' } }],
              },
            ],
          },
        ],
      },
      null,
    )
    const blocks = toChatThreadPresentation(state).turns[0]?.blocks ?? []
    expect(blocks).toMatchObject([
      {
        type: 'activity',
        kind: 'file',
        activities: [
          {
            id: 'file-1',
            title: 'Changed files',
            aggregatedDiff: expect.stringContaining('+++ b/a.ts'),
          },
        ],
      },
    ])
    expect(JSON.stringify(blocks)).not.toContain('turnDiff')
  })

  it('creates a semantic file activity when only an aggregated turn diff exists', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            diff: '--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+export {}',
            items: [],
          },
        ],
      },
      null,
    )
    expect(toChatThreadPresentation(state).turns[0]?.blocks).toMatchObject([
      {
        type: 'activity',
        kind: 'file',
        activities: [
          {
            sourceType: 'fileChange',
            title: 'Changed files',
            aggregatedDiff: expect.stringContaining('+++ b/new.ts'),
          },
        ],
      },
    ])
  })

  it('preserves add, delete, and move file change details', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                id: 'file-1',
                type: 'fileChange',
                status: 'completed',
                changes: [
                  { path: 'new.ts', kind: { type: 'add' }, diff: '+new' },
                  { path: 'old.ts', kind: { type: 'delete' }, diff: '-old' },
                  {
                    path: 'before.ts',
                    kind: { type: 'move', move_path: 'after.ts' },
                    diff: '+changed',
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
    )
    const fileBlock = toChatThreadPresentation(state).turns[0]?.blocks[0]
    expect(fileBlock).toMatchObject({
      type: 'activity',
      activities: [
        {
          changes: [
            { path: 'new.ts', kind: 'add', diff: '+new' },
            { path: 'old.ts', kind: 'delete', diff: '-old' },
            { path: 'before.ts', kind: 'move', movePath: 'after.ts', diff: '+changed' },
          ],
        },
      ],
    })
  })

  it('maps command metadata and terminal outcomes', () => {
    const state = createCodexThreadState(
      {
        id: 't',
        turns: [
          {
            id: 'u',
            status: 'completed',
            items: [
              {
                id: 'c',
                type: 'commandExecution',
                status: 'failed',
                command: 'npm test',
                exitCode: 1,
                durationMs: 42,
              },
            ],
          },
        ],
      },
      null,
    )
    const presentation = toChatThreadPresentation(state)
    expect(presentation.turns[0]?.blocks).toMatchObject([
      {
        type: 'activity',
        kind: 'command',
        activities: [
          expect.objectContaining({
            status: 'failed',
            commandStatus: 'failed',
            exitCode: 1,
          }),
        ],
      },
    ])
    expect(JSON.stringify(presentation)).toContain('"durationMs":42')
  })
})

describe('Codex persisted event hydration', () => {
  it('restores Thread token usage from a persisted usage event', () => {
    const state = createCodexThreadState({ id: 'thread-1', turns: [] }, null)
    applyHistoryEvents(state, [
      historyEvent(9, 'thread/tokenUsage/updated', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          modelContextWindow: 1000,
          last: { inputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
          total: { inputTokens: 10, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30 },
        },
      }),
    ])

    expect(toChatThreadPresentation(state).tokenUsage).toMatchObject({
      modelContextWindow: 1000,
      total: { totalTokens: 30 },
    })
  })

  it('restores the latest Thread selection from a saved settings event', () => {
    const state = createCodexThreadState({ id: 'thread-1', turns: [] }, null)
    applyHistoryEvents(state, [
      historyEvent(9, 'thread/settings/updated', {
        threadId: 'thread-1',
        model: 'gpt-5.6-terra',
        reasoningEffort: 'high',
      }),
    ])

    expect(toChatThreadPresentation(state)).toMatchObject({
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    })
  })

  it('restores a command lifecycle once from its saved events', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
      null,
    )
    const events = [
      historyEvent(10, 'item/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'cmd-1', type: 'commandExecution', status: 'inProgress', command: 'dir' },
      }),
      historyEvent(11, 'item/commandExecution/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        delta: 'file.txt\n',
      }),
      historyEvent(12, 'item/commandExecution/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        delta: 'sub/',
      }),
      historyEvent(13, 'item/completed', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'cmd-1', type: 'commandExecution', status: 'completed', command: 'dir' },
      }),
    ]
    applyHistoryEvents(state, events)
    applyHistoryEvents(state, events)

    const turn = (
      state.thread.turns as Array<{
        items?: Array<{ id?: string; type?: string; status?: string; aggregatedOutput?: string }>
      }>
    )[0]
    expect(turn?.items).toHaveLength(1)
    expect(turn?.items?.[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      status: 'completed',
      aggregatedOutput: 'file.txt\nsub/',
    })
  })

  it('never revives a command for a turn outside the snapshot', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
      null,
    )
    applyHistoryEvents(state, [
      historyEvent(10, 'item/started', {
        threadId: 'thread-1',
        turnId: 'rolled-back-turn',
        item: { id: 'cmd-1', type: 'commandExecution', status: 'inProgress', command: 'rm' },
      }),
    ])
    expect(state.thread.turns).toHaveLength(1)
    expect((state.thread.turns as Array<{ id?: string }>)[0]?.id).toBe('turn-1')
  })

  it('rehydrates a sparse completed turn from persisted assistant events', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
      null,
    )
    applyHistoryEvents(state, [
      historyEvent(10, 'item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'answer-1',
        delta: 'Persisted answer',
      }),
      historyEvent(11, 'turn/completed', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', items: [] },
      }),
    ])

    expect(toChatThreadPresentation(state).turns[0]?.blocks).toEqual([
      { id: 'answer-1', type: 'assistant', text: 'Persisted answer' },
    ])
  })

  it('leaves persisted assistant deltas for SSE when a sparse turn is still active', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    applyHistoryEvents(state, [
      historyEvent(10, 'item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'answer-1',
        delta: 'Do not hydrate this as one batch',
      }),
    ])

    expect(toChatThreadPresentation(state).turns[0]?.blocks).toEqual([])
    expect(state.seenEventIds.has('10')).toBe(false)
  })

  it('rehydrates a missing turn from its persisted lifecycle and assistant events', () => {
    const state = createCodexThreadState({ id: 'thread-1', turns: [] }, null)
    applyHistoryEvents(state, [
      historyEvent(10, 'turn/started', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'inProgress', items: [] },
      }),
      historyEvent(11, 'item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'answer-1',
        delta: 'Persisted answer',
      }),
      historyEvent(12, 'turn/completed', {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', items: [] },
      }),
    ])

    expect(toChatThreadPresentation(state).turns).toEqual([
      expect.objectContaining({
        id: 'turn-1',
        status: 'completed',
        blocks: [{ id: 'answer-1', type: 'assistant', text: 'Persisted answer' }],
      }),
    ])
  })

  it('ignores events for another thread and non-command items', () => {
    const state = createCodexThreadState(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [{ id: 'user-1', type: 'userMessage', content: [] }],
          },
        ],
      },
      null,
    )
    applyHistoryEvents(state, [
      historyEvent(10, 'item/started', {
        threadId: 'thread-2',
        turnId: 'turn-1',
        item: { id: 'cmd-1', type: 'commandExecution', status: 'inProgress', command: 'dir' },
      }),
      historyEvent(11, 'item/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'msg-1', type: 'agentMessage', text: 'hello' },
      }),
      historyEvent(12, 'turn/completed', { threadId: 'thread-1', turnId: 'turn-1' }),
    ])
    expect((state.thread.turns as Array<{ items?: unknown[] }>)[0]?.items).toEqual([
      { id: 'user-1', type: 'userMessage', content: [] },
    ])
  })

  it('skips events whose ids were already processed', () => {
    const raw = {
      id: 'thread-1',
      turns: [{ id: 'turn-1', status: 'completed', items: [] }],
    }
    const state = createCodexThreadState(raw, null)
    applyCodexNotification(
      state,
      {
        method: 'item/started',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { id: 'cmd-1', type: 'commandExecution', status: 'inProgress', command: 'dir' },
        },
      },
      '10',
    )
    applyHistoryEvents(state, [
      historyEvent(10, 'item/commandExecution/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        delta: 'first',
      }),
    ])
    const item = (state.thread.turns as Array<{ items?: Array<{ aggregatedOutput?: string }> }>)[0]
      ?.items?.[0]
    expect(item?.aggregatedOutput).toBeUndefined()
  })
})
