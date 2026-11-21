import type { ConversationId } from '@codex-web/conversation'
import type { StreamHandlers, StreamRequest } from '@/lib/owner-ws/owner-runtime'
import { describe, expect, it, vi } from 'vitest'
import { createOwnerConversationClient } from './owner-conversation-client'

const conversationId = 'thread-1' as ConversationId
const createdAt = '2026-01-01T00:00:00.000Z'

function readResult(epoch: string, sequence: number, id = conversationId) {
  return {
    cursor: { epoch, sequence },
    snapshot: {
      id,
      status: 'active',
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

function delivery(epoch: string, sequence: number, threadId = 'thread-1', title = 'Updated') {
  return {
    cursor: { epoch, sequence },
    event: {
      eventId: sequence,
      type: 'conversation.change',
      runtime: 'codex',
      threadId,
      createdAt,
      payload: {
        change: {
          type: 'conversation.updated',
          conversationId: threadId,
          title,
          identity: {
            sourceId: 'adapter',
            sourceEventId: `${epoch}-${sequence}`,
            receivedAt: createdAt,
          },
        },
      },
    },
  }
}

function setup() {
  const read = vi.fn().mockResolvedValue(readResult('epoch-1', 7))
  const streams: Array<{ request: StreamRequest; handlers: StreamHandlers; cancel: () => void }> =
    []
  const client = createOwnerConversationClient({
    read,
    openStream(request, handlers) {
      const cancel = vi.fn()
      streams.push({ request, handlers, cancel })
      handlers.onOpen?.({
        subscriptionId: 'subscription-1',
        cursor: { epoch: 'epoch-1', sequence: 99 },
      })
      return { streamId: 'stream-1', cancel }
    },
  })
  const observer = { replaceSnapshot: vi.fn(), applyChange: vi.fn(), transportError: vi.fn() }
  const abort = new AbortController()
  const watch = () => client.watch({ projectId: null, conversationId }, observer, abort.signal)
  return { read, streams, observer, abort, watch }
}

describe('Owner Conversation client', () => {
  it('subscribes at the snapshot cursor and resumes at the last delivered event', async () => {
    const { streams, observer, abort, watch } = setup()
    const done = watch()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    const [initial] = streams
    expect(initial.request).toEqual({
      method: 'events.subscribe',
      params: {
        scope: 'thread',
        threadId: conversationId,
        cursor: { epoch: 'epoch-1', sequence: 7 },
      },
    })
    initial.handlers.onEvent(delivery('epoch-1', 7))
    initial.handlers.onEvent(delivery('epoch-0', 10))
    initial.handlers.onEvent(delivery('epoch-1', 8))
    initial.handlers.onEvent(delivery('epoch-1', 8))
    initial.handlers.onClose?.()
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(streams[1].request).toEqual({
      method: 'events.resume',
      params: { subscriptionId: 'subscription-1', cursor: { epoch: 'epoch-1', sequence: 8 } },
    })
    initial.handlers.onEvent(delivery('epoch-1', 9))
    streams[1].handlers.onEvent(delivery('epoch-1', 9))
    expect(observer.applyChange.mock.calls).toEqual([
      [delivery('epoch-1', 8).event.payload.change],
      [delivery('epoch-1', 9).event.payload.change],
    ])
    abort.abort()
    await done
    expect(
      streams.every(({ cancel }) => vi.isMockFunction(cancel) && cancel.mock.calls.length === 1),
    ).toBe(true)
    expect(observer.transportError).not.toHaveBeenCalled()
  })

  it('reopens a snapshot on reset without adopting the reset cursor or late deliveries', async () => {
    const { read, streams, observer, abort, watch } = setup()
    const replacement = Promise.withResolvers<ReturnType<typeof readResult>>()
    read.mockResolvedValueOnce(readResult('epoch-1', 7)).mockReturnValueOnce(replacement.promise)
    const done = watch()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    streams[0].handlers.onEvent({
      method: 'events.reset',
      params: { cursor: { epoch: 'epoch-2', sequence: 20 } },
    })
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    streams[0].handlers.onEvent(delivery('epoch-1', 8))
    expect(streams).toHaveLength(1)
    replacement.resolve(readResult('epoch-2', 24))
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(streams[1].request.params).toMatchObject({ cursor: { epoch: 'epoch-2', sequence: 24 } })
    streams[1].handlers.onEvent(delivery('epoch-1', 25))
    streams[1].handlers.onEvent(delivery('epoch-2', 25))
    expect(observer.applyChange).toHaveBeenCalledExactlyOnceWith(
      delivery('epoch-2', 25).event.payload.change,
    )
    expect(observer.replaceSnapshot).toHaveBeenCalledTimes(2)
    abort.abort()
    await done
  })

  it.each([
    [
      'conflicting identity',
      delivery('epoch-1', 8, conversationId, 'Different'),
      'Conflicting Owner event identity.',
    ],
    ['another thread', delivery('epoch-1', 9, 'thread-2'), 'Unexpected Owner event thread.'],
  ])('fails closed on %s', async (_name, invalid, message) => {
    const { streams, observer, watch } = setup()
    const done = watch()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    const { handlers, cancel } = streams[0]
    handlers.onEvent(delivery('epoch-1', 8))
    handlers.onEvent(invalid)
    handlers.onEvent(delivery('epoch-1', 10))
    await done
    expect(observer.transportError).toHaveBeenCalledWith(new Error(message))
    expect(observer.applyChange).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(streams).toHaveLength(1)
  })
})
