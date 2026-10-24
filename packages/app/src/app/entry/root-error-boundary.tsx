import { Component, type ReactNode } from 'react'
import { toast } from '@/components/ui/toast'

export class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: unknown }
> {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown) {
    toast.add({
      title: 'Page failed to render',
      description: describeRenderError(error),
      type: 'error',
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <p className="text-sm text-muted-foreground">This screen could not be rendered.</p>
          <button
            type="button"
            className="rounded-md border px-4 py-2 text-sm"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
          >
            Reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

function describeRenderError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.replace(/[\r\n]+/g, ' ').slice(0, 300)
    return `${error.name}: ${message || 'No error message was provided.'}`
  }
  return 'The browser reported an unknown rendering error.'
}
