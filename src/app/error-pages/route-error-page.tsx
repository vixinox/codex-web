import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ForbiddenPage } from './forbidden-page'
import { NotFoundPage } from './not-found-page'
import { ServerErrorPage } from './server-error-page'
import { ServiceUnavailablePage } from './service-unavailable-page'

export type RouteErrorPageProps = {
  /** Optional pre-captured error; falls back to useRouteError(). */
  error?: unknown
  /** Overrides the default navigate('/') action on every rendered page. */
  onGoHome?: () => void
  /** Overrides the default navigate(-1) action on every rendered page. */
  onGoBack?: () => void
}

/**
 * Status-aware page for react-router errorElement slots. Maps a route error to
 * the matching page; anything unrecognized renders the server error page.
 */
export function RouteErrorPage({ error, onGoHome, onGoBack }: RouteErrorPageProps = {}) {
  const capturedRouteError = useRouteError()
  const routeError = error ?? capturedRouteError
  const navigation = { onGoHome, onGoBack }

  if (isRouteErrorResponse(routeError)) {
    const { status, statusText } = routeError
    if (status === 401 || status === 403) return <ForbiddenPage {...navigation} />
    if (status === 404) return <NotFoundPage {...navigation} />
    if (status === 503) return <ServiceUnavailablePage {...navigation} />
    if (status >= 500) {
      return <ServerErrorPage {...navigation} title={statusText || undefined} />
    }
  }

  return <ServerErrorPage {...navigation} />
}
