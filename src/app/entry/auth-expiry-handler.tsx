import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { AUTH_EXPIRED_EVENT } from '@/lib/auth/auth-expiry'

export function AuthExpiryHandler() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refetch } = useSession()
  const refetchRef = useRef(refetch)
  const handlingRef = useRef(false)

  refetchRef.current = refetch

  useEffect(() => {
    const handleAuthExpired = () => {
      if (handlingRef.current || location.pathname === '/login') return
      handlingRef.current = true
      void signOut()
        .catch(() => undefined)
        .then(() => refetchRef.current())
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
