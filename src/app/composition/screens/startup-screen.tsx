import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import architectureDiagram from '@/assets/codex-web-architecture.svg'
import { MockWorkspacePreview } from './mock/mock-workspace-preview'
import { MockSettingsPreview } from './mock/mock-settings-preview'

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText)
}

export function StartupScreen() {
  const navigate = useNavigate()
  const isZh = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language)

  const containerRef = useRef<HTMLDivElement>(null)
  const pipelineLineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = gsap.context(() => {
      const createTextReveal = (
        selector: string,
        trigger: string | Element | null,
        delay = 0.2,
      ) => {
        SplitText.create(selector, {
          type: 'words,lines',
          linesClass: 'line',
          autoSplit: true,
          mask: 'lines',
          onSplit: (self) => {
            const animation = gsap.from(self.lines, {
              duration: 1,
              delay,
              yPercent: prefersReducedMotion ? 0 : 100,
              stagger: prefersReducedMotion ? 0 : 0.1,
              ease: 'expo.out',
              paused: true,
              scrollTrigger: trigger
                ? {
                  trigger,
                  start: 'top 90%',
                  toggleActions: 'play none none none',
                }
                : undefined,
            })

            if (!trigger) {
              animation.play()
            }

            return animation
          },
        })
      }

      createTextReveal('.hero-text', null)
      createTextReveal('.architecture-title', '.arch-section')
      createTextReveal('.architecture-description', '.arch-section', 0.4)
      createTextReveal('.workspace-title', '.workspace-section')
      createTextReveal('.workspace-description', '.workspace-section', 0.4)
      createTextReveal('.settings-title', '.settings-section')
      createTextReveal('.settings-description', '.settings-section', 0.4)

      if (pipelineLineRef.current) {
        gsap.fromTo(
          pipelineLineRef.current,
          { scaleY: 0 },
          {
            scaleY: 1,
            delay: 0.2,
            ease: 'none',
            scrollTrigger: {
              trigger: containerRef.current,
              start: 'top top',
              end: 'bottom bottom',
              scrub: 0.5,
            },
          },
        )
      }

      gsap.fromTo(
        '.workspace-component',
        {
          borderColor: 'var(--border)',
          boxShadow: '0 0 0 0px transparent',
        },
        {
          borderColor: 'var(--primary)',
          boxShadow: '0 10px 30px -10px rgba(0,0,0,0.05)',
          duration: 1.2,
          delay: 0.2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: '.workspace-section',
            start: 'top 60%',
            toggleActions: 'play reverse play reverse',
          },
        },
      )

      gsap.fromTo(
        '.settings-component',
        {
          borderColor: 'var(--border)',
          boxShadow: '0 0 0 0px transparent',
        },
        {
          borderColor: 'var(--primary)',
          boxShadow: '0 10px 30px -10px rgba(0,0,0,0.05)',
          duration: 1.2,
          delay: 0.2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: '.settings-section',
            start: 'top 60%',
            toggleActions: 'play reverse play reverse',
          },
        },
      )
    }, containerRef)

    return () => {
      ctx.revert()
    }
  }, [])

  return (
    <div ref={containerRef} className="relative w-full overflow-x-hidden bg-background">
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
              {isZh ? '开始使用' : 'Get Started'}
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
              <svg aria-hidden="true" className="mr-2 size-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.73.084-.73 1.205.085 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.175 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3.003-.404c1.018.005 2.043.138 3.003.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.652.24 2.872.12 3.175.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              GitHub
            </Button>
          </div>
        </div>

        <div className="relative flex flex-col gap-20 pl-0 md:pl-8">
          <div className="absolute top-0 left-0 hidden h-full w-1 overflow-hidden rounded-full bg-border/40 md:block">
            <div
              ref={pipelineLineRef}
              className="h-full w-full origin-top rounded-full bg-linear-to-b from-primary via-success to-border"
              style={{ transform: 'scaleY(0)' }}
            />
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

            <img
              src={architectureDiagram}
              alt="Codex Web Architecture"
              className="block h-auto w-full rounded-3xl border border-border bg-white p-4"
            />
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
                {isZh ? '可在面板中切换主题，或查看其他设置。' : 'Switch themes or view other settings in the panel.'}
              </p>
            </div>
            <MockSettingsPreview className="settings-component" />
          </section>
        </div>
      </main>
    </div>
  )
}
