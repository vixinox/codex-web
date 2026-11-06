import { Component, type ReactNode } from 'react'
import { toast } from '@/components/ui/toast'
import { presentAppError } from '@/lib/errors/presentation'

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
  return presentAppError(error, 'The screen could not be rendered.')
}
