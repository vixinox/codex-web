import { afterEach, describe, expect, it, vi } from 'vitest'

import { openGuestEventStream, readGuestSession } from './guest'
import { guestComposerAdapter } from '@/app/chat/session/guest-composer-adapter'

class FakeEventSource {
  static latest: FakeEventSource | null = null
  readonly listeners = new Map<string, EventListener>()
  readonly url: string | URL
  onerror: ((event: Event) => void) | null = null
  closed = false

  constructor(url: string | URL) {
    this.url = url
    FakeEventSource.latest = this
  }

  addEventListener(name: string, listener: EventListener) {
    this.listeners.set(name, listener)
  }

  close() {
    this.closed = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeEventSource.latest = null
})

describe('Guest event stream', () => {
  it('subscribes to token usage updates and forwards the safe event envelope', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const received = vi.fn()
    const close = openGuestEventStream('thread / 1', 7, received)
    const source = FakeEventSource.latest!
    const message = {
      method: 'thread/tokenUsage/updated',
      params: { threadId: 'thread / 1', turnId: 'turn-1', tokenUsage: {} },
    }

    expect(String(source.url)).toBe('/guest-api/events?threadId=thread%20%2F%201&afterId=7')
    expect(source.listeners.has('thread/settings/updated')).toBe(true)
    source.listeners.get('thread/tokenUsage/updated')?.({
      data: JSON.stringify(message),
      lastEventId: '8',
    } as MessageEvent<string>)
    expect(received).toHaveBeenCalledWith({ id: 8, message })

    close()
    expect(source.closed).toBe(true)
  })
})

describe('Guest runtime contract', () => {
  it('accepts and returns the Guest context window from the session DTO', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          guestId: 'guest-1',
          expiresAt: '2026-09-12T00:00:00.000Z',
          runtime: {
            kind: 'guest-runtime',
            status: 'ready',
            maxActiveThreads: 5,
            modelContextWindow: 256000,
            sandbox: 'workspaceWrite',
            network: 'disabled',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const session = await readGuestSession()

    expect(session?.runtime.modelContextWindow).toBe(256000)
    expect(fetchMock).toHaveBeenCalledWith('/guest-api/session', {
      credentials: 'include',
      signal: undefined,
    })
  })

  it('uses the Guest adapter fallback without touching Owner configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          guestId: 'guest-1',
          expiresAt: '2026-09-12T00:00:00.000Z',
          runtime: {
            kind: 'guest-runtime',
            status: 'ready',
            maxActiveThreads: 5,
            modelContextWindow: 128000,
            sandbox: 'workspaceWrite',
            network: 'disabled',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(guestComposerAdapter.readContextWindow?.()).resolves.toBe(128000)
    expect(fetchMock).toHaveBeenCalledWith('/guest-api/session', {
      credentials: 'include',
      signal: undefined,
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/configuration/context-window',
      expect.anything(),
    )
  })

  it('rejects a Guest session with an invalid context window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            guestId: 'guest-1',
            expiresAt: '2026-09-12T00:00:00.000Z',
            runtime: {
              kind: 'guest-runtime',
              status: 'ready',
              maxActiveThreads: 5,
              modelContextWindow: 0,
              sandbox: 'workspaceWrite',
              network: 'disabled',
            },
          }),
          { status: 200 },
        ),
      ),
    )

    await expect(readGuestSession()).rejects.toThrow('Guest access is unavailable')
  })
})
