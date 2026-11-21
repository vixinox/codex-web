import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import * as React from 'react'

import { createRoot } from 'react-dom/client'

import {
  createThreadSession,
  useThreadSessionSnapshot,
  toThreadPresentationSnapshot,
} from '@/app/chat/session/state/thread-session-store'

import { ThreadAssets } from '@/app/chat/transcript/thread-assets'

import { ThreadComposerSlot } from '@/app/chat/composer/ui/thread-composer-slot'

import { buildThreadComposerSlot } from '@/app/chat/session/presentation/thread-composer-slot'

import { reconcilePendingThread } from '@/app/chat/session/state/thread-pending-reconciliation'

import { EMPTY_OWNER_COMPOSER_CAPABILITIES } from '@/app/chat/composer/model/composer-capabilities'

import type { ComposerViewModel } from '@/app/chat/model/composer-types'

import type { ChatPendingTurn } from '@/app/chat/model/types'

import { applyScenarioStep, nextDelay, type Scenario } from './replay'

import { scenarios } from './scenarios'

import { ThemeProvider, useTheme } from '@/components/shared/theme-provider'
import { WorkspaceLayout } from '@/app/composition/workspace-layout'
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarItem,
  SidebarSection,
} from '@/components/shared/sidebar'
import '../../index.css'

const initialComposer: ComposerViewModel = {
  draft: '',
  model: 'demo',
  effort: 'medium',
  collaborationMode: 'default',
  submitting: false,
  working: false,
  error: null,
  skills: { status: 'ready', items: [] },
  selectedSkills: [],
}

const capabilities = {
  ...EMPTY_OWNER_COMPOSER_CAPABILITIES,
  availableModels: ['demo'],
  availableEfforts: ['medium'],
}

function Scene({
  scenario,
  catalog,
  sidebarWidth,
  setSidebarWidth,
}: {
  scenario: Scenario
  catalog: React.ReactNode
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
}) {
  const [epoch, setEpoch] = React.useState(0)

  const session = React.useMemo(() => {
    const value = createThreadSession(`dev:${scenario.id}:${epoch}`, null)

    if (!scenario.loading) value.replaceConversation(scenario.initial)

    return value
  }, [scenario, epoch])

  React.useEffect(() => () => session.dispose(), [session])

  const snapshot = useThreadSessionSnapshot(session)

  const [index, setIndex] = React.useState(0)

  const [playing, setPlaying] = React.useState(false)

  const [pending, setPending] = React.useState<ChatPendingTurn | null>(null)

  const [composer, setComposer] = React.useState(initialComposer)

  const [target, setTarget] = React.useState('')

  const [selecting, setSelecting] = React.useState(false)

  const [notice, setNotice] = React.useState('')

  const [lockEpoch, setLockEpoch] = React.useState(0)

  const [tab, setTab] = React.useState('event')

  const [panel, setPanel] = React.useState<'scenarios' | 'inspector'>('scenarios')

  const commandSequence = React.useRef(0)

  const thread = toThreadPresentationSnapshot(snapshot)

  const visible = pending ? reconcilePendingThread(thread, pending) : thread

  const next = React.useCallback(() => {
    const step = scenario.steps[index]

    if (!step) {
      setPlaying(false)
      return
    }

    applyScenarioStep(session, step)

    if (step.kind === 'pending') setPending(step.pending)

    setIndex((value) => value + 1)

    if (index + 1 === scenario.steps.length) setPlaying(false)
  }, [scenario, index, session])

  React.useEffect(() => {
    if (!playing) return

    const delay = nextDelay(scenario.steps, index)

    if (delay === null) {
      setPlaying(false)
      return
    }

    const timer = window.setTimeout(next, delay)

    return () => window.clearTimeout(timer)
  }, [playing, index, scenario, next])

  const reset = () => {
    setPlaying(false)
    setIndex(0)
    setPending(null)
    setComposer(initialComposer)
    setTarget('')
    setNotice('')
    setPanel('scenarios')
    setEpoch((value) => value + 1)
  }

  const emit = (
    change: Parameters<typeof session.applyConversationChange>[0] extends infer C
      ? C extends { identity: unknown }
      ? Omit<C, 'identity'>
      : never
      : never,
  ) => {
    session.applyConversationChange({
      ...change,
      identity: {
        sourceId: 'dev-action' as import('@codex-web/conversation').SourceId,
        sourceEventId:
          `action-${++commandSequence.current}` as import('@codex-web/conversation').SourceEventId,
        receivedAt: '2026-01-01T00:00:00Z',
      },
    })
  }

  const stop = async () => {
    setPlaying(false)

    for (const turn of Object.values(session.getConversation()?.turns ?? {}))
      if (turn.status === 'inProgress' || turn.status === 'queued')
        emit({ type: 'turn.statusChanged', turnId: turn.id, status: 'cancelled' })

    setNotice('已在本地停止；未发送真实命令。')
  }

  const actions = {
    setDraft: (draft: string) => setComposer((value) => ({ ...value, draft })),

    setModel: (model: string) => setComposer((value) => ({ ...value, model })),

    setEffort: (effort: string) => setComposer((value) => ({ ...value, effort })),

    setCollaborationMode: (collaborationMode: 'default' | 'plan') =>
      setComposer((value) => ({ ...value, collaborationMode })),

    retrySkills: () => { },
    stop,

    submit: async (text: string) => {
      if (!text.trim()) return

      setComposer((value) => ({ ...value, draft: '' }))

      setPending({
        clientTurnId: `local-${++commandSequence.current}`,
        optimisticThreadId: thread.id,
        nativeThreadId: thread.id,
        projectId: null,
        text,
        startedAt: Date.now(),
      })

      setLockEpoch((value) => value + 1)

      setNotice('本地发送事务已创建；重置可恢复场景。')
    },

    retry: reset,

    answerUserInput: async (answers: Record<string, { answers: string[] }>) => {
      const request = visible.userInput

      if (request)
        emit({
          type: 'interaction.resolved',
          interactionId: request.requestId as import('@codex-web/conversation').InteractionId,
          outcome: {
            kind: 'answers',
            answers: Object.fromEntries(
              Object.entries(answers).map(([key, value]) => [key, value.answers]),
            ),
          },
        })
    },

    cancelUserInput: stop,
  }

  const slot = buildThreadComposerSlot(
    { ...composer, working: visible.isBusy },
    visible.turns,
    visible.userInput,
  )

  const data =
    tab === 'event'
      ? (scenario.steps[index - 1] ?? scenario.initial)
      : tab === 'state'
        ? session.getConversation()
        : visible

  const copy = async () => {
    const value = JSON.stringify(
      {
        scenario: scenario.id,
        name: scenario.name,
        step: index,
        target: target || null,
        source: scenario.source,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
      null,
      2,
    )

    try {
      await navigator.clipboard.writeText(value)
      setNotice('已复制目标上下文。')
    } catch {
      setNotice(value)
    }
  }

  return (
    <WorkspaceLayout
      className="min-w-[1280px]"
      sidebar={
        <Sidebar
          className="w-(--sidebar-width) shrink-0"
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
        >
          <SidebarHeader className="gap-3 px-4">
            <h1 className="text-lg font-semibold">UI 场景工作台</h1>
            <p className="text-xs text-muted-foreground">开发专用 · 合成数据 · 无 Owner 连接</p>
            <ThemeControls />
          </SidebarHeader>
          <div className="grid grid-cols-2 gap-1 border-b border-sidebar-border p-2">
            <Button
              variant={panel === 'scenarios' ? 'secondary' : 'ghost'}
              onClick={() => setPanel('scenarios')}
            >
              场景
            </Button>
            <Button
              variant={panel === 'inspector' ? 'secondary' : 'ghost'}
              onClick={() => setPanel('inspector')}
            >
              检查
            </Button>
          </div>
          <SidebarContent className="flex flex-col gap-3">
            {panel === 'scenarios' ? (
              <>
                <ControlSection title="场景目录">{catalog}</ControlSection>
                <ControlSection title="回放控制">
                  <p className="text-sm font-medium">{scenario.name}</p>
                  <p className="text-xs text-muted-foreground">{scenario.description}</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={playing ? 'secondary' : 'default'}
                      size="lg"
                      className="min-w-28"
                      disabled={index === scenario.steps.length}
                      onClick={() => setPlaying(!playing)}
                    >
                      {playing ? '暂停投递' : '播放'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={playing || index === scenario.steps.length}
                      onClick={next}
                    >
                      下一步
                    </Button>
                    <Button variant="outline" size="sm" onClick={reset}>
                      重置
                    </Button>
                    <span className="text-xs">
                      {index} / {scenario.steps.length}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    暂停仅停止投递，不冻结已开始的动画。
                  </p>
                </ControlSection>
              </>
            ) : (
              <>
                <ControlSection title="状态检查">
                  <Select
                    value={tab}
                    onValueChange={(value) => {
                      if (value !== null) setTab(value)
                    }}
                  >
                    <SelectTrigger aria-label="检查数据类型" className="w-full">
                      <SelectValue>
                        {
                          (
                            { event: '当前输入', state: '领域状态', view: '展示结果' } as Record<
                              string,
                              string
                            >
                          )[tab]
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {[
                          ['event', '当前输入'],
                          ['state', '领域状态'],
                          ['view', '展示结果'],
                        ].map(([id, label]) => (
                          <SelectItem key={id} value={id}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <pre
                    aria-label="状态数据"
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-auto rounded-md border border-sidebar-border bg-app-surface p-3 font-mono text-[11px] leading-5"
                  >
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </ControlSection>
                <ControlSection title="目标上下文">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-pressed={selecting}
                      onClick={() => setSelecting(!selecting)}
                    >
                      {selecting ? '退出选择' : '选择目标'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void copy()}>
                      复制上下文
                    </Button>
                  </div>
                  <p className="break-words text-xs text-muted-foreground">
                    {target ? `已选择：${target}` : '选择聊天节点后可复制场景、步骤和源码入口。'}
                  </p>
                </ControlSection>
              </>
            )}
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border pt-2">
            <div className="flex items-center justify-between gap-2 px-2 text-xs text-muted-foreground">
              <span className="truncate" role="status">
                {notice || (target ? `目标：${target}` : '合成数据 · 本地交互')}
              </span>
              <span className="shrink-0 tabular-nums">
                {index}/{scenario.steps.length}
              </span>
            </div>
          </SidebarFooter>
        </Sidebar>
      }
    >
      <div
        className="min-h-0 flex-1 overflow-auto"
        onClickCapture={(event) => {
          if (!selecting) return
          const element = (event.target as Element).closest<HTMLElement>('[data-ui-target]')
          if (!element) return
          event.preventDefault()
          event.stopPropagation()
          setTarget(element.dataset.uiTarget ?? '')
          setSelecting(false)
        }}
      >
        {snapshot.status === 'error' ? (
          <div role="alert" className="p-8">
            {snapshot.error}
            <Button variant="outline" size="sm" onClick={reset}>
              重试
            </Button>
          </div>
        ) : snapshot.status === 'idle' ? (
          <p role="status" className="p-8">
            正在加载会话…
          </p>
        ) : (
          <>
            <div className="px-4 pt-2 text-xs text-app-text-muted">{snapshot.error}</div>
            <ThreadAssets
              key={epoch}
              thread={visible}
              session={session}
              lockEpoch={lockEpoch}
              initialScrollPosition="bottom"
            />
          </>
        )}
      </div>
      {snapshot.status === 'ready' ? (
        <div data-ui-target="composer" className="py-3">
          <ThreadComposerSlot
            key={epoch}
            slot={
              slot.kind === 'questionnaire'
                ? { ...slot, pendingCount: visible.pendingInputCount }
                : slot
            }
            actions={actions}
            capabilities={capabilities}
          />
        </div>
      ) : null}
    </WorkspaceLayout>
  )
}

function ControlSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SidebarSection>
      <Collapsible defaultOpen className="group/section">
        <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}>
          <ChevronRight
            data-icon="inline-start"
            className="transition-transform group-data-[open]/section:rotate-90"
          />
          {title}
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          <div className="flex flex-col gap-3 pb-2">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarSection>
  )
}

function ThemeControls() {
  const { mode, setMode, themes, resolvedVariant, themeId, setThemeForVariant } = useTheme()
  const modes = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ]
  return (
    <FieldGroup className="grid grid-cols-2 gap-2">
      <Field>
        <FieldLabel htmlFor="playground-mode">外观</FieldLabel>
        <Select
          value={mode}
          onValueChange={(value) => {
            if (value === 'system' || value === 'light' || value === 'dark') setMode(value)
          }}
        >
          <SelectTrigger id="playground-mode" aria-label="外观模式" className="w-full">
            <SelectValue>{modes.find((entry) => entry.value === mode)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modes.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="playground-theme">主题</FieldLabel>
        <Select
          value={themeId}
          onValueChange={(value) => {
            if (value !== null) setThemeForVariant(resolvedVariant, value)
          }}
        >
          <SelectTrigger id="playground-theme" aria-label="主题" className="w-full">
            <SelectValue>{themes.find((theme) => theme.id === themeId)?.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {themes
                .filter((theme) => theme.source.variant === resolvedVariant)
                .map((theme) => (
                  <SelectItem key={theme.id} value={theme.id}>
                    {theme.name}
                  </SelectItem>
                ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  )
}

function Workbench() {
  const [sidebarWidth, setSidebarWidth] = React.useState(400)

  const fromUrl = new URLSearchParams(window.location.search).get('scenario')

  const [selected, setSelected] = React.useState(
    scenarios.find((entry) => entry.id === fromUrl) ?? scenarios[0],
  )

  const [query, setQuery] = React.useState('')

  return (
    <Scene
      key={selected.id}
      scenario={selected}
      sidebarWidth={sidebarWidth}
      setSidebarWidth={setSidebarWidth}
      catalog={
        <nav aria-label="场景目录">
          <Input
            className="mb-2"
            aria-label="搜索场景"
            placeholder="搜索名称或 ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-col gap-1">
            {scenarios
              .filter((entry) => `${entry.id} ${entry.name}`.includes(query))
              .map((entry) => (
                <SidebarItem
                  key={entry.id}
                  active={selected.id === entry.id}
                  className="aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
                  onClick={() => {
                    setSelected(entry)
                    window.history.replaceState(null, '', `?scenario=${entry.id}`)
                  }}
                >
                  <span className="truncate">{entry.name}</span>
                </SidebarItem>
              ))}
          </div>
        </nav>
      }
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Workbench />
  </ThemeProvider>,
)
