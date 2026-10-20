import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { requiresProfileReset } from '@/lib/auth/runtime-profile'
import { AppRouter } from '@/app/entry/app-router'
import { pageFallback } from '@/app/entry/route-components'
import { getSessionKind } from '@/app/entry/session-kind'

export function RuntimeProfileGuard() {
  const navigate = useNavigate()
  const { data: session, isPending, refetch } = useSession()
  const [ready, setReady] = useState(false)
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const kind = session ? getSessionKind(session.user) : undefined

  useEffect(() => {
    if (isPending) return () => {}
    if (!session) {
      setReady(true)
      return () => {}
    }
    let disposed = false
    let checking = false
    const checkProfile = async () => {
      if (checking) return
      checking = true
      try {
        const response = await fetch('/runtime-profile', { credentials: 'include' })
        if (!response.ok || disposed) {
          if (!disposed) setReady(true)
          return
        }
        const body: unknown = await response.json()
        if (disposed || !isRuntimeProfileResponse(body)) return
        const profile = body.profile
        const previous = window.sessionStorage.getItem('codex-web:runtime-profile')
        if (requiresProfileReset(previous, profile, kind)) {
          setReady(false)
          const result = await signOut()
          if (result.error || disposed) return
          window.sessionStorage.setItem('codex-web:runtime-profile', profile)
          await refetchRef.current()
          if (!disposed) void navigate('/login', { replace: true })
        } else {
          window.sessionStorage.setItem('codex-web:runtime-profile', profile)
          setReady(true)
        }
      } catch {
        if (!disposed) setReady(true)
      } finally {
        checking = false
      }
    }

    const handleResume = () => {
      if (document.visibilityState === 'visible') void checkProfile()
    }
    const handleFocus = () => void checkProfile()
    const handleOnline = () => void checkProfile()
    void checkProfile()
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleResume)
    return () => {
      disposed = true
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleResume)
    }
  }, [isPending, kind, navigate, session])

  return ready ? <AppRouter /> : pageFallback
}

function isRuntimeProfileResponse(value: unknown): value is { profile: 'owner' | 'guest' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'profile' in value &&
    (value.profile === 'owner' || value.profile === 'guest')
  )
}
