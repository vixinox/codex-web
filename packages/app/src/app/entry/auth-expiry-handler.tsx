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
    const handleAuthExpired = () => {
      if (handlingRef.current || location.pathname === '/login') return
      handlingRef.current = true
      const profileId = sessionStorage.getItem('codex-web:active-connection-profile')
      if (profileId) {
        void clearConnectionProfileSession(profileId).catch(() => undefined)
        sessionStorage.removeItem('codex-web:active-connection-profile')
      } else {
        clearLocalOwnerSession()
      }
      void navigate('/login', { replace: true })
      handlingRef.current = false
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [location.pathname, navigate])

  return null
}
