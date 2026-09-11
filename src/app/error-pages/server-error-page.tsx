import { Home, RotateCcw, TriangleAlert } from 'lucide-react'
import { useInRouterContext, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { ErrorPage } from './error-page'

export type ServerErrorPageProps = {
  /** Overrides the default "Something went wrong" heading. */
  title?: string
  /** Overrides the default description. */
  description?: string
  /** Overrides the default window.location.reload() action. */
  onRetry?: () => void
  /** Overrides the default navigate('/') action. */
  onGoHome?: () => void
}

export function ServerErrorPage({
  title = 'Something went wrong',
  description = 'An unexpected error occurred on our end. Please try again.',
  onRetry,
  onGoHome,
}: ServerErrorPageProps = {}) {
  const inRouter = useInRouterContext()

  if (inRouter)
    return (
      <RoutedServerErrorPage
        title={title}
        description={description}
        onRetry={onRetry}
        onGoHome={onGoHome}
      />
    )

  return (
    <ServerErrorPageView
      title={title}
      description={description}
      onRetry={onRetry}
      onGoHome={onGoHome ?? (() => window.location.assign('/'))}
    />
  )
}

function RoutedServerErrorPage(
  props: Required<Pick<ServerErrorPageProps, 'title' | 'description'>> &
    Pick<ServerErrorPageProps, 'onRetry' | 'onGoHome'>,
) {
  const navigate = useNavigate()

  return <ServerErrorPageView {...props} onGoHome={props.onGoHome ?? (() => navigate('/'))} />
}

function ServerErrorPageView({
  title,
  description,
  onRetry,
  onGoHome,
}: Required<Pick<ServerErrorPageProps, 'title' | 'description'>> &
  Pick<ServerErrorPageProps, 'onRetry' | 'onGoHome'>) {
  return (
    <ErrorPage
      code={500}
      icon={<TriangleAlert aria-hidden="true" />}
      title={title}
      description={description}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onGoHome}>
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
