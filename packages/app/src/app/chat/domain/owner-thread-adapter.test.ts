import { describe, expect, it, vi } from 'vitest'
import { setOwnerBridge } from '@/lib/bridge/owner-runtime'
import { ownerThreadDomainAdapter } from './owner-thread-adapter'

describe('owner thread domain adapter', () => {
  it('subscribes and resumes with complete cursors and deduplicates replayed events', async () => {
    const openStream = vi.fn()
    const request = vi.fn()
    setOwnerBridge({ request, openStream })
    const onEvent = vi.fn()
    openStream
      .mockImplementationOnce((_request, handlers) => {
        handlers.onOpen?.({ subscriptionId: 'sub-1', cursor: { epoch: 'e1', sequence: 3 } })
        handlers.onEvent({
          cursor: { epoch: 'e1', sequence: 4 },
          event: { method: 'thread/updated', params: {} },
        })
        handlers.onError?.(new Error('closed'))
        return { streamId: 'stream-1', cancel: vi.fn() }
      })
      .mockImplementationOnce((_request, handlers) => {
        handlers.onEvent({
          cursor: { epoch: 'e1', sequence: 4 },
          event: { method: 'thread/updated', params: {} },
        })
        handlers.onEvent({
          cursor: { epoch: 'e1', sequence: 5 },
          event: { method: 'thread/closed', params: {} },
        })
        return { streamId: 'stream-2', cancel: vi.fn() }
      })
    const initial = { epoch: 'e1', sequence: 3 }
    const unsubscribe = ownerThreadDomainAdapter.subscribe('thread-1', initial, onEvent)
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
    expect(openStream.mock.calls[0]?.[0]).toEqual({
      method: 'events.subscribe',
      params: { scope: 'thread', threadId: 'thread-1', cursor: initial },
    })
    expect(openStream.mock.calls[1]?.[0]).toEqual({
      method: 'events.resume',
      params: { subscriptionId: 'sub-1', cursor: { epoch: 'e1', sequence: 4 } },
    })
    expect(request).not.toHaveBeenCalled()
    expect(onEvent.mock.calls.map(([event]) => event.cursor)).toEqual([
      { epoch: 'e1', sequence: 4 },
      { epoch: 'e1', sequence: 5 },
    ])
    unsubscribe()
    setOwnerBridge(null)
  })

  it('surfaces reset cursor from event params and ignores malformed cursors', () => {
    const openStream = vi.fn((_request, handlers) => {
      handlers.onEvent({
        method: 'events.reset',
        params: { cursor: { epoch: 'e2', sequence: 1 }, reason: 'epoch_changed' },
      })
      handlers.onEvent({ cursor: 2, event: { method: 'thread/updated', params: {} } })
      return { streamId: 'stream-1', cancel: vi.fn() }
    })
    setOwnerBridge({ request: vi.fn(), openStream })
    const onEvent = vi.fn()
    const onError = vi.fn()
    const unsubscribe = ownerThreadDomainAdapter.subscribe(
      'thread-1',
      { epoch: 'e1', sequence: 8 },
      onEvent,
      onError,
    )
    expect(onError).toHaveBeenCalledWith({ epoch: 'e2', sequence: 1 }, true)
    expect(onEvent).not.toHaveBeenCalled()
    unsubscribe()
    setOwnerBridge(null)
  })
})
