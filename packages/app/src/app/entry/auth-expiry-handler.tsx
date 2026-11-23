import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AUTH_EXPIRED_EVENT } from '@/lib/auth/auth-expiry'
import { clearConnectionProfileSession } from '@/lib/remote/device-key-store'
import { clearLocalOwnerSession } from '@/lib/auth/auth-client'

export function AuthExpiryHandler() {
  const navigate = useNavigate()
  const location = useLocation()
  const handlingRef = useRef(false)

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      if (handlingRef.current || location.pathname === '/login') return
      handlingRef.current = true
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined
      const profileId =
        detail &&
        typeof detail === 'object' &&
        'profileId' in detail &&
        typeof detail.profileId === 'string'
          ? detail.profileId
          : sessionStorage.getItem('codex-web:active-connection-profile')
      const cleanup = profileId
        ? clearConnectionProfileSession(profileId)
        : Promise.resolve(clearLocalOwnerSession())
      if (profileId && sessionStorage.getItem('codex-web:active-connection-profile') === profileId)
        sessionStorage.removeItem('codex-web:active-connection-profile')
      void cleanup
        .catch(() => undefined)
        .finally(() => {
          void navigate('/login', { replace: true })
          handlingRef.current = false
        })
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [location.pathname, navigate])

  return null
}
