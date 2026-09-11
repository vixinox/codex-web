import { ArrowLeft, FileQuestion, Home } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { ErrorPage } from './error-page'

export type NotFoundPageProps = {
  /** Overrides the default navigate('/') action. */
  onGoHome?: () => void
  /** Overrides the default navigate(-1) action. */
  onGoBack?: () => void
}

export function NotFoundPage({ onGoHome, onGoBack }: NotFoundPageProps = {}) {
  const navigate = useNavigate()

  return (
    <ErrorPage
      code={404}
      icon={<FileQuestion aria-hidden="true" />}
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved."
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
