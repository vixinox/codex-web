import { afterEach, describe, expect, it, vi } from 'vitest'

import { AUTH_EXPIRED_EVENT, installAuthExpiryInterceptor } from './auth-expiry'

let restore: (() => void) | undefined

describe('auth expiry interceptor', () => {
  afterEach(() => {
    restore?.()
    restore = undefined
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it.each(['/api/projects', '/guest-api/session', '/admin-api/overview'])(
    'reports unauthorized responses from %s',
    async (path) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const expired = vi.fn()
      window.addEventListener(AUTH_EXPIRED_EVENT, expired)
      restore = installAuthExpiryInterceptor()

      const response = await window.fetch(path)

      expect(expired).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(401)
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired)
    },
  )

  it.each([
    '/api/auth/sign-in/email',
    '/api/auth/get-session',
    '/runtime-profile',
    'https://other.example/api/projects',
  ])('does not report unauthorized responses from %s', async (path) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const expired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, expired)
    restore = installAuthExpiryInterceptor()

    await window.fetch(path)

    expect(expired).not.toHaveBeenCalled()
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired)
  })

  it('does not wrap fetch more than once and restores the original fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const expired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, expired)

    const firstRestore = installAuthExpiryInterceptor()
    const secondRestore = installAuthExpiryInterceptor()
    await window.fetch('/api/projects')

    expect(secondRestore).toBe(firstRestore)
    expect(expired).toHaveBeenCalledTimes(1)
    firstRestore()
    expect(window.fetch).toBe(fetchMock)
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired)
  })
})
