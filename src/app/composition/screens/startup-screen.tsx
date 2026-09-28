import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import architectureDiagram from '@/assets/codex-web-architecture.svg'
import { MockWorkspacePreview } from './mock/mock-workspace-preview'
import { MockSettingsPreview } from './mock/mock-settings-preview'

export function StartupScreen() {
  const navigate = useNavigate()
  const isZh = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language)

  return (
    <div className="relative w-full overflow-x-hidden bg-background">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] bg-size-[24px_24px] opacity-[0.15]" />
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-20 px-5 py-10 text-foreground selection:bg-foreground selection:text-background sm:px-8 sm:py-14 lg:px-12 lg:py-16">
        <div className="relative mt-12 space-y-6 pl-0 md:pl-8">
          <h1 className="split hero-text text-3xl font-medium tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Codex Web
          </h1>
          <p className="split hero-text max-w-2xl text-xl leading-relaxed text-muted-foreground">
            {isZh
              ? '本地 Codex Web 客户端，提供 Owner 与 Guest 运行时。'
              : 'Local Codex Web client with Owner and Guest runtimes.'}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              size="lg"
              className="group rounded-full bg-foreground px-6 font-medium text-background transition-all hover:bg-foreground/90"
              onClick={() => navigate('/login')}
            >
              {isZh ? '在线试用' : 'Get Started'}
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-full border-border px-6 font-medium hover:bg-muted/50"
              onClick={() =>
                window.open('https://github.com/vixinox/codex-web', '_blank', 'noopener,noreferrer')
              }
            >
              GitHub
            </Button>
          </div>
        </div>
        <div className="relative flex flex-col gap-20 pl-0 md:pl-8">
          <div className="absolute top-0 left-0 hidden h-full w-1 overflow-hidden rounded-full bg-border/40 md:block">
            <div className="h-full w-full rounded-full bg-linear-to-b from-primary via-success to-border" />
          </div>
          <section className="arch-section relative w-full space-y-4">
            <div className="space-y-1.5">
              <h2 className="split architecture-title text-2xl font-medium tracking-tight text-foreground">
                {isZh ? '系统架构' : 'System Architecture'}
              </h2>
              <p className="split architecture-description max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {isZh
                  ? 'Fastify Bridge 连接客户端与 Owner、Guest 运行时。'
                  : 'Fastify Bridge connects the client to the Owner and Guest runtimes.'}
              </p>
            </div>
            <div className="w-full rounded-3xl border border-border bg-white p-4">
              <img
                src={architectureDiagram}
                alt="Codex Web Architecture"
                width={1379}
                height={683}
                className="block h-auto w-full"
              />
            </div>
          </section>
          <section className="workspace-section relative w-full space-y-4">
            <div className="space-y-1.5">
              <h2 className="split workspace-title text-2xl font-medium tracking-tight text-foreground">
                {isZh ? '工作区' : 'Workspace'}
              </h2>
              <p className="split workspace-description max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {isZh
                  ? '覆盖 Codex 核心能力。点击下方对话详情，预览 Agent 工作过程。'
                  : 'Covering the core capabilities of Codex. Click on the conversation details below to preview the Agent working process.'}
              </p>
            </div>
            <MockWorkspacePreview className="workspace-component" />
          </section>
          <section className="settings-section relative w-full space-y-4">
            <div className="space-y-1.5">
              <h2 className="split settings-title text-2xl font-medium tracking-tight text-foreground">
                {isZh ? '系统设置' : 'System Settings'}
              </h2>
              <p className="split settings-description max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {isZh
                  ? '可在面板中切换主题，或查看其他设置。'
                  : 'Switch themes or view other settings in the panel.'}
              </p>
            </div>
            <MockSettingsPreview className="settings-component" />
          </section>
        </div>
      </main>
    </div>
  )
}
