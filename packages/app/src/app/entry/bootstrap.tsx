import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from '@/components/ui/toast'
import { ThemeProvider } from '@/components/shared/theme-provider'
import { installAuthExpiryInterceptor } from '@/lib/auth/auth-expiry'
import { AuthExpiryHandler } from '@/app/entry/auth-expiry-handler'
import { RootErrorBoundary } from '@/app/entry/root-error-boundary'
import { AppRouter } from '@/app/entry/app-router'
import { consumeRemoteBootstrap } from '@/lib/remote/bootstrap'

let remoteBootstrap =
  typeof window === 'undefined' ? null : consumeRemoteBootstrap(window.location.href).value

export function getRemoteBootstrap() {
  return remoteBootstrap
}

export function bootstrapApp(rootElement: HTMLElement = document.getElementById('root')!) {
  installAuthExpiryInterceptor()
  if (window.location.hash) {
    const parsed = consumeRemoteBootstrap(window.location.href)
    if (parsed.value) remoteBootstrap = parsed.value
    window.history.replaceState(null, '', parsed.cleanUrl)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <Toaster />
      <RootErrorBoundary>
        <BrowserRouter>
          <ThemeProvider>
            <AuthExpiryHandler />
            <AppRouter />
          </ThemeProvider>
        </BrowserRouter>
      </RootErrorBoundary>
    </StrictMode>,
  )
}
