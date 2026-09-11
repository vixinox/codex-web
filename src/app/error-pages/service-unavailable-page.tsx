import { CloudOff, Home, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { ErrorPage } from './error-page'

export type ServiceUnavailablePageProps = {
  /** Overrides the default "Service unavailable" heading. */
  title?: string
  /** Overrides the default description. */
  description?: string
  /** Overrides the default window.location.reload() action. */
  onRetry?: () => void
  /** Overrides the default navigate('/') action. */
  onGoHome?: () => void
}

export function ServiceUnavailablePage({
  title = 'Service unavailable',
  description = 'The service is temporarily unavailable. Please try again in a moment.',
  onRetry,
  onGoHome,
}: ServiceUnavailablePageProps = {}) {
  const navigate = useNavigate()

  return (
    <ErrorPage
      code={503}
      icon={<CloudOff aria-hidden="true" />}
      title={title}
      description={description}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onGoHome ?? (() => navigate('/'))}>
            <Home data-icon="inline-start" />
            Go home
          </Button>
          <Button type="button" onClick={onRetry ?? (() => window.location.reload())}>
            <RotateCcw data-icon="inline-start" />
            Try again
          </Button>
        </>
      }
    />
  )
}
