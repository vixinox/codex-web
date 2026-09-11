import { ArrowLeft, Home, ShieldX } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { ErrorPage } from './error-page'

export type ForbiddenPageProps = {
  /** Overrides the default navigate('/') action. */
  onGoHome?: () => void
  /** Overrides the default navigate(-1) action. */
  onGoBack?: () => void
}

export function ForbiddenPage({ onGoHome, onGoBack }: ForbiddenPageProps = {}) {
  const navigate = useNavigate()

  return (
    <ErrorPage
      code={403}
      icon={<ShieldX aria-hidden="true" />}
      title="Access denied"
      description="You don't have permission to view this page."
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onGoBack ?? (() => navigate(-1))}>
            <ArrowLeft data-icon="inline-start" />
            Go back
          </Button>
          <Button type="button" onClick={onGoHome ?? (() => navigate('/'))}>
            <Home data-icon="inline-start" />
            Go home
          </Button>
        </>
      }
    />
  )
}
