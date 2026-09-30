import * as React from 'react'
import {
  ArrowUpIcon,
  CheckIcon,
  CircleIcon,
  Lightbulb,
  PlusIcon,
  ShieldAlertIcon,
  SquareIcon,
  X,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import type { ChatTokenUsage } from '@/app/chat/model/types'
import type { ChatEffort, ChatModel } from '@/app/chat/model/composer-types'
import type { ComposerCapabilities } from '../model/composer-capabilities'
import { contextUsagePercent, formatContextUsage, formatTokenTotals } from '../logic/usage-format'
import { cn } from '@/lib/utils'
import { useCanHover } from '@/lib/platform/browser/use-can-hover'

const modelDisplayName = (value: string) => {
  return value
    .replace(/^gpt-/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const effortDisplayName = (value: string) =>
  value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
const ACCESS_LABELS = {
  full: 'Full access',
  readOnly: 'Read-only',
  workspaceWrite: 'Guest workspace',
} as const

export type ComposerControlsProps = {
  collaborationMode: 'default' | 'plan'
  onCollaborationModeChange?: (mode: 'default' | 'plan') => void
  model: ChatModel
  onModelChange: (value: ChatModel) => void
  effort: ChatEffort
  onEffortChange: (value: ChatEffort) => void
  onOpenCommandPanel: () => void
  capabilities: ComposerCapabilities
  tokenUsage?: ChatTokenUsage
  contextWindow?: number
  disabled: boolean
  submitting: boolean
  working: boolean
  onSubmit: () => void
  onStop?: () => void
  canSubmit: boolean
}

export function ComposerControls({
  collaborationMode,
  onCollaborationModeChange,
  model,
  onModelChange,
  effort,
  onEffortChange,
  onOpenCommandPanel,
  capabilities,
  tokenUsage,
  contextWindow,
  disabled,
  submitting,
  working,
  onSubmit,
  onStop,
  canSubmit,
}: ComposerControlsProps) {
  const controlsRef = React.useRef<HTMLDivElement>(null)
  const [compact, setCompact] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const canHover = useCanHover()
  const blocked = disabled
  const visibleModelOptions = capabilities.availableModels.map((value) => ({
    value,
    label: modelDisplayName(capabilities.modelDisplayNames[value] ?? value),
  }))
  const effortOptions = capabilities.availableEfforts.map((value) => ({
    value,
    label: effortDisplayName(value),
  }))
  React.useEffect(() => {
    const element = controlsRef.current
    if (!element) return
    const update = () => setCompact(element.clientWidth < 420)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={controlsRef} className="flex min-w-0 flex-nowrap items-center gap-2">
      <button
        type="button"
        onClick={onOpenCommandPanel}
        className="app-interactive -ml-1 inline-flex size-8 items-center justify-center rounded-full text-app-text-muted hover:text-foreground disabled:pointer-events-none"
        title="Open command panel"
        aria-label="Open command panel"
        disabled={blocked}
      >
        <PlusIcon className="size-5" />
      </button>
      {canHover ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  'inline-flex min-w-0 items-center gap-2 rounded-full text-sm font-medium text-app-access-mode',
                  compact ? 'p-1' : 'px-2 py-1',
                )}
                aria-label={ACCESS_LABELS[capabilities.access]}
              />
            }
          >
            <ShieldAlertIcon className="size-4.5" />
            {compact ? null : <span>{ACCESS_LABELS[capabilities.access]}</span>}
          </TooltipTrigger>
          <TooltipContent>{ACCESS_LABELS[capabilities.access]}</TooltipContent>
        </Tooltip>
      ) : (
        <Popover>
          <PopoverTrigger
            nativeButton={false}
            render={
              <span
                className="inline-flex min-w-0 items-center gap-2 rounded-full p-1 text-sm font-medium text-app-access-mode"
                aria-label={ACCESS_LABELS[capabilities.access]}
              />
            }
          >
            <ShieldAlertIcon className="size-4.5" />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 text-sm">
            {ACCESS_LABELS[capabilities.access]}
          </PopoverContent>
        </Popover>
      )}
      {collaborationMode === 'plan' ? (
        <button
          type="button"
          onClick={() => onCollaborationModeChange?.('default')}
          className="app-interactive group inline-flex cursor-pointer items-center gap-2 rounded-full px-2 py-1 text-sm text-muted-foreground"
          aria-pressed="true"
          aria-label="Plan mode enabled. Switch to Default mode"
        >
          <span className="relative flex size-4 items-center justify-center">
            <Lightbulb className="absolute inset-0 size-4 group-hover:opacity-0" />
            <X className="absolute inset-0 size-4 opacity-0 group-hover:opacity-100" />
          </span>
          <span>Plan</span>
        </button>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {capabilities.contextUsage && contextUsagePercent(tokenUsage, contextWindow) !== null ? (
          <ContextUsageInfo
            canHover={canHover}
            tokenUsage={tokenUsage}
            contextWindow={contextWindow}
          />
        ) : null}
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                disabled={blocked}
                className="app-interactive inline-flex h-10 min-w-0 items-center gap-2 rounded-full px-2.5 text-sm text-app-text-muted hover:text-foreground disabled:pointer-events-none sm:h-8"
              />
            }
          >
            <span className="truncate">
              {modelDisplayName(capabilities.modelDisplayNames[model] ?? model)}{' '}
              {effortDisplayName(effort)}
            </span>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-52 border-app-border bg-app-surface-raised p-1 text-foreground"
            role="listbox"
            aria-label="Model and reasoning effort"
            aria-multiselectable="true"
          >
            <div role="group" aria-label="Models">
              {visibleModelOptions.map((option) => (
                <OptionButton
                  key={option.value}
                  selected={option.value === model}
                  selectedBackground={false}
                  onClick={() => {
                    onModelChange(option.value)
                    setModelOpen(false)
                  }}
                >
                  {option.label}
                </OptionButton>
              ))}
            </div>
            <div className="px-1">
              <Separator />
            </div>
            <div role="group" aria-label="Reasoning effort">
              {effortOptions.map((option) => {
                return (
                  <OptionButton
                    key={option.value}
                    selected={option.value === effort}
                    onClick={() => {
                      onEffortChange(option.value)
                      setModelOpen(false)
                    }}
                  >
                    {option.label}
                  </OptionButton>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          className="app-interactive inline-flex size-8 items-center justify-center rounded-full bg-app-send text-app-send-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title={submitting ? 'Sending message' : working ? 'Stop' : 'Send message'}
          aria-label={submitting ? 'Sending message' : working ? 'Stop' : 'Send message'}
          onClick={working ? onStop : onSubmit}
          disabled={disabled || submitting || (!working && !canSubmit)}
        >
          {submitting ? (
            <Spinner />
          ) : working ? (
            <SquareIcon className="size-3.5 fill-current" />
          ) : (
            <ArrowUpIcon strokeWidth="1.5" />
          )}
        </button>
      </div>
    </div>
  )
}

function ContextUsageDetails({
  tokenUsage,
  contextWindow,
}: {
  tokenUsage?: ChatTokenUsage
  contextWindow?: number
}) {
  return (
    <>
      <p className="font-medium text-app-text-muted">Context window:</p>
      <p className="font-medium text-foreground">{formatContextUsage(tokenUsage, contextWindow)}</p>
      <p className="font-medium text-foreground">{formatTokenTotals(tokenUsage, contextWindow)}</p>
    </>
  )
}

function ContextUsageInfo({
  canHover,
  tokenUsage,
  contextWindow,
}: {
  canHover: boolean
  tokenUsage?: ChatTokenUsage
  contextWindow?: number
}) {
  const trigger = (
    <button
      type="button"
      className="app-interactive inline-flex size-4 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`${contextUsagePercent(tokenUsage, contextWindow)}% context used`}
    />
  )
  const details = <ContextUsageDetails tokenUsage={tokenUsage} contextWindow={contextWindow} />
  return canHover ? (
    <HoverCard>
      <HoverCardTrigger delay={100} closeDelay={100} render={trigger}>
        <ContextUsageIndicator usage={tokenUsage} contextWindow={contextWindow} />
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        sideOffset={12}
        className="flex w-fit flex-col items-center gap-1 rounded-3xl border-app-border bg-app-surface-raised p-4 text-center shadow-[0_2px_12px_var(--app-shadow)]"
      >
        {details}
      </HoverCardContent>
    </HoverCard>
  ) : (
    <Popover>
      <PopoverTrigger render={trigger}>
        <ContextUsageIndicator usage={tokenUsage} contextWindow={contextWindow} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={12}
        className="flex w-fit flex-col items-center gap-1 rounded-3xl border-app-border bg-app-surface-raised p-4 text-center shadow-[0_2px_12px_var(--app-shadow)]"
      >
        {details}
      </PopoverContent>
    </Popover>
  )
}

function ContextUsageIndicator({
  usage,
  contextWindow,
}: {
  usage?: ChatTokenUsage
  contextWindow?: number
}) {
  const percent = contextUsagePercent(usage, contextWindow)
  const available = percent !== null
  return (
    <span
      className="relative inline-flex size-4"
      aria-label={percent === null ? 'Context window unavailable' : `${percent}% context used`}
    >
      <CircleIcon
        className="absolute inset-0 size-4 stroke-app-text-muted stroke-3"
        fill="none"
        aria-hidden="true"
      />
      <CircleIcon
        key={`context-usage-${available ? percent : 'unavailable'}`}
        className="absolute inset-0 size-4 -rotate-90 stroke-foreground stroke-3"
        fill="none"
        pathLength={100}
        strokeDasharray={available && percent > 0 ? `${percent} ${100 - percent}` : '0 100'}
        strokeDashoffset={0}
        aria-hidden="true"
      />
    </span>
  )
}

function OptionButton({
  selected,
  selectedBackground = true,
  disabled = false,
  onClick,
  children,
}: {
  selected: boolean
  selectedBackground?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={`${selectedBackground ? 'app-interactive-roving' : 'hover:bg-app-surface-subtle'} flex h-8 w-full items-center rounded-sm px-2 text-left text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="truncate">{children}</span>
      {selected ? <CheckIcon className="ml-auto size-4" /> : null}
    </button>
  )
}
