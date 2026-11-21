import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createConversationSnapshot, type ConversationId } from '@codex-web/conversation'
import type { StreamHandlers } from '@/lib/owner-ws/owner-runtime'
import type { ConversationClient } from '../domain/conversation-client'
import { useThreadDetailController } from './controllers/use-thread-detail-controller'

const ownerBridge = vi.hoisted(() => ({ request: vi.fn(), openStream: vi.fn() }))
vi.mock('@/lib/bridge/owner-runtime', () => ({ getOwnerBridge: () => ownerBridge }))

function openResult(epoch: string, sequence: number, title: string) {
  return {
    watermark: { epoch, sequence },
    snapshot: {
      id: 'thread-1',
      status: 'active',
      title,
      watermark: sequence,
      turns: {},
      messages: {},
      activities: {},
      interactions: {},
      agentLinks: {},
      diagnostics: [],
    },
  }
}

function update(epoch: string, sequence: number, status: 'active' | 'archived', title: string) {
  const createdAt = '2026-01-01T00:00:00.000Z'
  return {
    cursor: { epoch, sequence },
    event: {
      eventId: sequence,
      type: 'conversation.change',
      runtime: 'codex',
      threadId: 'thread-1',
      createdAt,
      payload: {
        change: {
          type: 'conversation.updated',
          conversationId: 'thread-1',
          status,
          title,
          identity: {
            sourceId: 'adapter',
            sourceEventId: `${epoch}-${sequence}`,
            applicationSequence: sequence,
            receivedAt: createdAt,
          },
        },
      },
    },
  }
}

it('opens, applies and replaces the production Conversation snapshot', async () => {
  vi.resetAllMocks()
  const streams: StreamHandlers[] = []
  ownerBridge.request
    .mockResolvedValueOnce(openResult('e1', 7, 'Initial'))
    .mockResolvedValueOnce(openResult('e2', 1, 'Replacement'))
  ownerBridge.openStream.mockImplementation((_request, handlers: StreamHandlers) => {
    streams.push(handlers)
    handlers.onOpen?.({ subscriptionId: 'sub-1' })
    return { streamId: 'stream-1', cancel: vi.fn() }
  })
  const onLifecycle = vi.fn()
  const mutations = { answerUserInput: vi.fn(), cancelTurn: vi.fn() }
  const rendered = renderHook(() =>
    useThreadDetailController(mutations, null, 'thread-1', undefined, onLifecycle),
  )
  await waitFor(() => expect(streams).toHaveLength(1))
  expect(ownerBridge.request).toHaveBeenCalledExactlyOnceWith(
    'threads.read',
    { projectId: null, threadId: 'thread-1' },
    { signal: expect.any(AbortSignal) },
  )
  expect(ownerBridge.openStream.mock.calls[0]?.[0]).toEqual({
    method: 'events.subscribe',
    params: { scope: 'thread', threadId: 'thread-1', cursor: { epoch: 'e1', sequence: 7 } },
  })
  act(() => streams[0].onEvent(update('e1', 8, 'active', 'Live')))
  await waitFor(() =>
    expect(rendered.result.current.model).toMatchObject({
      status: 'ready',
      thread: { title: 'Live' },
    }),
  )
  act(() => streams[0].onError?.(new Error('Disconnected')))
  await waitFor(() => expect(streams).toHaveLength(2))
  expect(ownerBridge.openStream.mock.calls[1]?.[0]).toEqual({
    method: 'events.resume',
    params: { subscriptionId: 'sub-1', cursor: { epoch: 'e1', sequence: 8 } },
  })
  act(() =>
    streams[1].onEvent({
      method: 'events.reset',
      params: { cursor: { epoch: 'e2', sequence: 0 } },
    }),
  )
  await waitFor(() => expect(streams).toHaveLength(3))
  expect(rendered.result.current.model).toMatchObject({
    status: 'ready',
    thread: { title: 'Replacement' },
  })
  act(() => {
    streams[1].onEvent(update('e1', 9, 'archived', 'Late'))
    streams[2].onEvent(update('e2', 2, 'archived', 'Archived'))
    streams[2].onEvent(update('e2', 2, 'archived', 'Archived'))
  })
  expect(onLifecycle).toHaveBeenCalledExactlyOnceWith('thread/archived')
  rendered.unmount()
  streams[2].onEvent(update('e2', 3, 'archived', 'Late'))
  expect(onLifecycle).toHaveBeenCalledTimes(1)
})

it('shows loading on initial retry and retains the transcript on a stream failure', async () => {
  const conversationId = 'retry-thread' as ConversationId
  const watch = vi.fn<ConversationClient['watch']>().mockResolvedValue(undefined)
  const client = { watch }
  const mutations = { answerUserInput: vi.fn(), cancelTurn: vi.fn() }
  const { result } = renderHook(() =>
    useThreadDetailController(mutations, null, conversationId, undefined, undefined, client),
  )

  expect(result.current.model.status).toBe('loading')
  act(() => watch.mock.calls[0][1].transportError(new Error('Read failed')))
  await waitFor(() => expect(result.current.model.status).toBe('error'))
  expect(result.current.eventError).toBeNull()

  act(() => result.current.retry())
  await waitFor(() => expect(result.current.model.status).toBe('loading'))
  const snapshot = { ...createConversationSnapshot(conversationId), title: 'Recovered' }
  act(() => watch.mock.calls[1][1].replaceSnapshot(snapshot))
  await waitFor(() =>
    expect(result.current.model).toMatchObject({ status: 'ready', thread: { title: 'Recovered' } }),
  )

  act(() => watch.mock.calls[1][1].transportError(new Error('Stream failed')))
  expect(result.current.eventError).toBeTruthy()
  expect(result.current.model).toMatchObject({ status: 'ready', thread: { title: 'Recovered' } })

  act(() => result.current.retry())
  expect(result.current.eventError).toBeNull()
  expect(result.current.model).toMatchObject({ status: 'ready', thread: { title: 'Recovered' } })
})
