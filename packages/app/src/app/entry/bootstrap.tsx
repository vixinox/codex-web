import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from '@/components/ui/toast'
import { ThemeProvider } from '@/components/shared/theme-provider'
import { installAuthExpiryInterceptor } from '@/lib/auth/auth-expiry'
import { AuthExpiryHandler } from '@/app/entry/auth-expiry-handler'
import { RootErrorBoundary } from '@/app/entry/root-error-boundary'
import { AppRouter } from '@/app/entry/app-router'
export function bootstrapApp(rootElement: HTMLElement = document.getElementById('root')!) {
  installAuthExpiryInterceptor()

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
