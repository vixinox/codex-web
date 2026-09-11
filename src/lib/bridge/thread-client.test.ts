import { afterEach, describe, expect, it, vi } from 'vitest'

import { isThreadAvailabilityRace, waitForThreadAvailability } from './thread-client'

describe('shared Thread client availability', () => {
  afterEach(() => vi.useRealTimers())

  it('retries a transient snapshot failure through the shared seam', async () => {
    vi.useFakeTimers()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockRejectedValueOnce({ status: 502 })
      .mockResolvedValue({ thread: { id: 'thread-1' }, eventCursor: 2 })

    const pending = waitForThreadAvailability(fetcher)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual({ thread: { id: 'thread-1' }, eventCursor: 2 })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not retry permanent failures', async () => {
    const fetcher = vi.fn().mockRejectedValue({ status: 401 })

    await expect(waitForThreadAvailability(fetcher)).rejects.toEqual({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('recognizes only the documented transient status codes', () => {
    expect([404, 502, 503].every((status) => isThreadAvailabilityRace({ status }))).toBe(true)
    expect(isThreadAvailabilityRace({ status: 401 })).toBe(false)
    expect(isThreadAvailabilityRace(new Error('offline'))).toBe(false)
  })
})
