import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodexRuntimeController } from './use-codex-runtime-controller'

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const status = (
  value: 'stopped' | 'starting' | 'ready' | 'failed',
  activeCredentialId: string | null,
  currentCredentialId: string | null = activeCredentialId,
  error: string | null = null,
) => ({
  status: value,
  projectId: null,
  activeCredentialId,
  currentCredentialId,
  pendingCredentialId: null,
  restartRequired: false,
  activeTurns: 0,
  error,
})

describe('useCodexRuntimeController', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses an already-running Codex process without starting it again', async () => {
    const fetch = vi.fn().mockResolvedValue(response(status('ready', 'credential-1')))
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useCodexRuntimeController())

    await waitFor(() => expect(result.current.bootstrapping).toBe(false))
    expect(result.current.model.status).toBe('started')
    expect(fetch.mock.calls.some(([input]) => String(input) === '/api/codex/start')).toBe(false)
  })

  it('keeps a stopped runtime idle until the user starts Codex', async () => {
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status')
        return response(status('stopped', null, 'credential-1'))
      return response({})
    })
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useCodexRuntimeController())

    await waitFor(() => expect(result.current.bootstrapping).toBe(false))
    expect(result.current.model.status).toBe('stopped')
    expect(fetch.mock.calls.filter(([input]) => String(input) === '/api/codex/start')).toHaveLength(
      0,
    )
  })

  it('enters the shell stopped when no current credential exists', async () => {
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status') return response(status('stopped', null, null))
      return response({})
    })
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useCodexRuntimeController())

    await waitFor(() => expect(result.current.bootstrapping).toBe(false))
    expect(result.current.model.status).toBe('stopped')
    expect(fetch.mock.calls.some(([input]) => String(input) === '/api/codex/start')).toBe(false)
  })

  it('does not attempt automatic startup for an available credential', async () => {
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status')
        return response(status('stopped', null, 'credential-1'))
      return response({})
    })
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useCodexRuntimeController())

    await waitFor(() => expect(result.current.bootstrapping).toBe(false))
    expect(result.current.model.status).toBe('stopped')
    expect(result.current.errorEvent).toBeNull()
  })

  it('starts without a browser confirmation prompt', async () => {
    const confirm = vi.fn(() => false)
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status') return response(status('stopped', null, null))
      if (String(input) === '/api/codex/start') return response(status('ready', 'credential-1'))
      return response({})
    })
    vi.stubGlobal('confirm', confirm)
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useCodexRuntimeController())
    await waitFor(() => expect(result.current.bootstrapping).toBe(false))

    await act(async () => {
      await result.current.start()
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(result.current.model.status).toBe('started')
    expect(fetch.mock.calls.filter(([input]) => String(input) === '/api/codex/start')).toHaveLength(
      1,
    )
  })

  it('moves a manual startup failure to error and emits one new error event per attempt', async () => {
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status') return response(status('stopped', null, null))
      if (String(input) === '/api/codex/start') return Promise.reject(new Error('Manual failure'))
      return response({})
    })
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useCodexRuntimeController())
    await waitFor(() => expect(result.current.bootstrapping).toBe(false))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.model.status).toBe('error')
    expect(result.current.errorEvent).toEqual({
      id: 1,
      message: 'Could not connect to the server. Try again.',
    })

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.errorEvent).toEqual({
      id: 2,
      message: 'Could not connect to the server. Try again.',
    })
    expect(fetch.mock.calls.filter(([input]) => String(input) === '/api/codex/start')).toHaveLength(
      2,
    )
  })

  it('deduplicates concurrent manual startup attempts and their error event', async () => {
    let resolveStart!: (value: Response) => void
    const startResponse = new Promise<Response>((resolve) => {
      resolveStart = resolve
    })
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status') return response(status('stopped', null, null))
      if (String(input) === '/api/codex/start') return startResponse
      return response({})
    })
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useCodexRuntimeController())
    await waitFor(() => expect(result.current.bootstrapping).toBe(false))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.start()
      second = result.current.start()
    })
    expect(fetch.mock.calls.filter(([input]) => String(input) === '/api/codex/start')).toHaveLength(
      1,
    )

    await act(async () => {
      resolveStart(Response.json(status('failed', null, null, 'Startup failed')))
      await Promise.all([first, second])
    })
    expect(result.current.model.status).toBe('error')
    expect(result.current.errorEvent).toEqual({ id: 1, message: 'Startup failed' })
  })

  it('waits for an existing start to become ready', async () => {
    let statusRequests = 0
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/codex/status') {
        statusRequests += 1
        return response(
          statusRequests === 1
            ? status('starting', 'credential-1')
            : status('ready', 'credential-1'),
        )
      }
      return response({})
    })
    vi.stubGlobal('fetch', fetch)

    const { result } = renderHook(() => useCodexRuntimeController())

    await waitFor(() => expect(result.current.bootstrapping).toBe(false))
    expect(result.current.model.status).toBe('started')
    expect(statusRequests).toBe(2)
  })
})
