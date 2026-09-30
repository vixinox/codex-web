import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Download, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/shared/copy-button'
import { MockWorkspacePreview } from './mock/mock-workspace-preview'
import { MockSettingsPreview } from './mock/mock-settings-preview'

type QuickStartStep = {
  title: string
  description: string
  zhDescription: string
  commands: readonly string[]
  note?: string
  zhNote?: string
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type NavigatorWithStandalone = Navigator & { standalone?: boolean }

const quickStartSteps: readonly QuickStartStep[] = [
  {
    title: 'Prepare the project',
    description:
      'Clone the project, install dependencies, configure the environment, and initialize the database.',
    zhDescription: '克隆项目、安装依赖、配置环境并初始化数据库。',
    commands: [
      'git clone https://github.com/vixinox/codex-web.git',
      'cd codex-web',
      'docker compose up -d postgres',
      'pnpm install',
      'cp .env.example .env',
      'Copy-Item .env.example .env',
      'pnpm db:push',
    ],
    note: 'Use Docker for PostgreSQL, or set DATABASE_URL in .env to connect to an existing database.',
    zhNote: 'PostgreSQL 可使用 Docker，也可以在 .env 中配置 DATABASE_URL 连接已有数据库。',
  },
  {
    title: 'Start Codex Web',
    description:
      'Run the frontend and Owner bridge in separate terminals, then open the local Web origin.',
    zhDescription: '在不同终端启动前端和 Owner bridge，然后打开本地 Web 地址。',
    commands: ['pnpm dev', 'pnpm server:owner'],
    note: 'Open http://localhost:5173. Guest is optional: run pnpm server:guest in another terminal. Owner and Guest are separate processes.',
    zhNote:
      '打开 http://localhost:5173。Guest 可选：另开终端运行 pnpm server:guest。Owner 和 Guest 是独立进程。',
  },
] as const

export function StartupScreen() {
  const navigate = useNavigate()
  const isZh = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language)
  const [platform, setPlatform] = useState<'unix' | 'windows'>('unix')

  return (
    <div className="relative w-full overflow-x-hidden bg-background">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] bg-size-[24px_24px] opacity-[0.15]" />
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-20 px-5 py-10 text-foreground selection:bg-foreground selection:text-background sm:px-8 sm:py-14 lg:px-12 lg:py-16">
        <div className="relative mt-12 space-y-6 pl-0 md:pl-8">
          <h1 className="split hero-text text-3xl font-medium tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Codex Web
          </h1>
          <p className="split hero-text text-xl leading-relaxed text-muted-foreground">
            {isZh
              ? '在本地运行 Codex Web，连接自己的 Owner 工作区，或使用隔离的 Guest 环境。'
              : 'Run Codex Web locally with your own Owner workspace or an isolated Guest environment.'}
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
          <PwaInstallBanner isZh={isZh} />
        </div>
        <div className="relative flex flex-col gap-20 pl-0 md:pl-8">
          <section className="quick-start-section relative w-full space-y-8">
            <div className="space-y-2">
              <h2 className="split quick-start-title text-2xl font-medium tracking-tight text-foreground">
                {isZh ? '开始使用' : 'Get started'}
              </h2>
              <p className="split quick-start-description max-w-3xl leading-relaxed text-muted-foreground">
                {isZh
                  ? '按照步骤准备本地环境，再进入 Codex Web 工作区。'
                  : 'Prepare your local environment, then open the Codex Web workspace.'}
              </p>
            </div>
            <div className="relative">
              <div
                className="absolute top-7 bottom-7 left-5 w-px bg-border sm:left-6"
                aria-hidden="true"
              />
              <div className="relative space-y-12">
                {quickStartSteps.map((step, index) => (
                  <QuickStartStepView
                    key={step.title}
                    step={step}
                    index={index}
                    isZh={isZh}
                    platform={platform}
                    onPlatformChange={setPlatform}
                  />
                ))}
              </div>
            </div>
          </section>
          <section className="workspace-section relative w-full space-y-4">
            <div className="space-y-1.5">
              <h2 className="split workspace-title text-2xl font-medium tracking-tight text-foreground">
                {isZh ? '工作区' : 'Workspace'}
              </h2>
              <p className="split workspace-description max-w-3xl leading-relaxed text-muted-foreground">
                {isZh
                  ? '覆盖 Codex 核心能力。点击交互下方对话详情，预览 Agent 工作过程。'
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
              <p className="split settings-description max-w-3xl leading-relaxed text-muted-foreground">
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

function PwaInstallBanner({ isZh }: { isZh: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as NavigatorWithStandalone).standalone === true

    setIsInstalled(isStandalone)

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  if (isInstalled) return null

  const handleInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <section className="flex max-w-4xl w-fit flex-col gap-4 rounded-xl border border-border bg-card p-4 mt-8 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <Smartphone className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 className="font-medium text-foreground">
            {isZh ? '在手机上使用 Codex Web' : 'Take Codex Web with you'}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {installPrompt
              ? isZh
                ? '添加到主屏幕，像应用一样快速打开。'
                : 'Add it to your home screen for quick app-like access.'
              : isZh
                ? '在浏览器菜单中选择“添加到主屏幕”'
                : 'Use your browser menu to add Codex Web to your home screen.'}
          </p>
        </div>
      </div>
      {installPrompt ? (
        <Button
          type="button"
          className="w-full gap-2 sm:w-auto"
          onClick={handleInstall}
          aria-label={isZh ? '将 Codex Web 安装到手机' : 'Install Codex Web'}
        >
          <Download aria-hidden="true" />
          {isZh ? '安装应用' : 'Install app'}
        </Button>
      ) : null}
    </section>
  )
}

function QuickStartStepView({
  step,
  index,
  isZh,
  platform,
  onPlatformChange,
}: {
  step: QuickStartStep
  index: number
  isZh: boolean
  platform: 'unix' | 'windows'
  onPlatformChange: (platform: 'unix' | 'windows') => void
}) {
  const commands = step.commands.filter((command) => {
    if (command === 'cp .env.example .env') return platform === 'unix'
    if (command === 'Copy-Item .env.example .env') return platform === 'windows'
    if (command === 'pnpm db:push') return false
    return true
  })

  return (
    <article className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-6">
      <div className="relative z-10 grid size-10 place-items-center rounded-full border border-border bg-background text-sm font-medium sm:size-12">
        {index + 1}
      </div>
      <div className="min-w-0 space-y-4 pt-1 sm:pt-2">
        <h3 className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">
          {step.title}
        </h3>
        <p className="max-w-3xl leading-relaxed text-muted-foreground">
          {isZh ? step.zhDescription : step.description}
        </p>
        {index === 0 ? (
          <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted p-1">
            <button
              type="button"
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${platform === 'unix' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => onPlatformChange('unix')}
            >
              macOS / Linux
            </button>
            <button
              type="button"
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${platform === 'windows' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => onPlatformChange('windows')}
            >
              Windows
            </button>
          </div>
        ) : null}
        <div className="space-y-2">
          {commands.map((command) => (
            <CommandBlock key={command} command={command} isZh={isZh} />
          ))}
        </div>
        {index === 0 ? (
          <div className="space-y-2">
            <CommandBlock command="pnpm db:push" isZh={isZh} />
            {platform === 'windows' ? (
              <CommandBlock command=".\setup-windows-sandbox.ps1" isZh={isZh} />
            ) : null}
          </div>
        ) : null}
        {step.note ? (
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {isZh ? step.zhNote : step.note}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function CommandBlock({ command, isZh }: { command: string; isZh: boolean }) {
  return (
    <div className="flex w-full max-w-3xl min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4">
      <code className="min-w-0 flex-1 scrollbar-none overflow-x-auto font-mono text-sm whitespace-nowrap text-foreground [&::-webkit-scrollbar]:hidden">
        {command}
      </code>
      <CopyButton
        variant="ghost"
        text={command}
        aria-label={isZh ? `复制命令 ${command}` : `Copy ${command}`}
      />
    </div>
  )
}
