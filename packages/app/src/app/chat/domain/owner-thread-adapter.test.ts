import { describe, expect, it, vi } from 'vitest'
import { setOwnerBridge } from '@/lib/bridge/owner-runtime'
import { ownerThreadDomainAdapter } from './owner-thread-adapter'

describe('owner thread domain adapter', () => {
  it('subscribes with a cursor and resumes after a stream error', async () => {
    const openStream = vi.fn()
    const request = vi.fn().mockResolvedValue({ subscriptionId: 'sub-1' })
    setOwnerBridge({ request, openStream })
    const onEvent = vi.fn()
    openStream
      .mockImplementationOnce((_request, handlers) => {
        handlers.onOpen?.({ subscriptionId: 'sub-1', cursor: 4 })
        handlers.onEvent({ cursor: 5, event: { method: 'thread/updated', params: {} } })
        handlers.onError?.(new Error('closed'))
        return { streamId: 'stream-1', cancel: vi.fn() }
      })
      .mockImplementationOnce((_request, handlers) => {
        handlers.onEvent({ cursor: 6, event: { method: 'thread/closed', params: {} } })
        return { streamId: 'stream-2', cancel: vi.fn() }
      })
    const unsubscribe = ownerThreadDomainAdapter.subscribe('thread-1', 3, onEvent)
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
    expect(openStream.mock.calls[0]?.[0]).toMatchObject({
      method: 'events.subscribe',
      params: { scope: 'thread', threadId: 'thread-1', afterId: 3 },
    })
    expect(openStream.mock.calls[1]?.[0]).toMatchObject({
      method: 'events.resume',
      params: { subscriptionId: 'sub-1', cursor: 5 },
    })
    expect(onEvent.mock.calls.map(([event]) => event.id)).toEqual([5, 6])
    unsubscribe()
    setOwnerBridge(null)
  })
})
