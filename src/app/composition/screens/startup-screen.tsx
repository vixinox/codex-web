import { useNavigate } from 'react-router'

import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MockWorkspacePreview } from './mock/mock-workspace-preview'

export function StartupScreen() {
  const navigate = useNavigate()
  const isZh = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-12 px-5 py-10 text-foreground selection:bg-foreground selection:text-background sm:px-8 sm:py-14 lg:px-12 lg:py-16">
      <div className="space-y-6 mt-18 pl-4">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">
          {isZh ? '本地 Codex Web UI' : 'A Web UI for Local Codex'}
        </h1>
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            className="rounded-full bg-white px-5 font-medium text-black hover:bg-neutral-200"
            onClick={() => navigate('/login')}
          >
            {isZh ? '开始使用' : 'Get Started'}
            <ArrowRight className="ml-1.5 size-3.5" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="rounded-full px-5 font-medium"
            onClick={() => window.open('https://github.com/vixinox/codex-web', '_blank', 'noopener,noreferrer')}
          >
            <svg
              aria-hidden="true"
              className="size-4 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.73.084-.73 1.205.085 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.175 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.018.005 2.043.138 3.003.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.652.24 2.872.12 3.175.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            GitHub
          </Button>
        </div>
      </div>
      <MockWorkspacePreview />
    </main>
  )
}
