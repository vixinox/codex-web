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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import type { ChatTokenUsage } from '@/app/chat/model/types'
import type { ChatAccess, ChatEffort, ChatModel } from '@/app/chat/model/composer-types'
import type { ComposerCapabilities } from './composer-capabilities'
import { contextUsagePercent, formatContextUsage, formatTokenTotals } from './usage-format'

const MODEL_OPTIONS = [
  { value: 'gpt-5.6-sol', label: '5.6 Sol' },
  { value: 'gpt-5.6-terra', label: '5.6 Terra' },
  { value: 'gpt-5.5', label: '5.5' },
] as const satisfies readonly { value: ChatModel; label: string }[]
const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
] as const satisfies readonly { value: ChatEffort; label: string }[]
const ACCESS_OPTIONS = [
  { value: 'full', label: 'Full access' },
  { value: 'readOnly', label: 'Read-only' },
  { value: 'workspaceWrite', label: 'Guest workspace' },
] as const satisfies readonly { value: ChatAccess; label: string }[]

const labelFor = (options: readonly { value: string; label: string }[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value

export type ComposerControlsProps = {
  collaborationMode: 'default' | 'plan'
  onCollaborationModeChange?: (mode: 'default' | 'plan') => void
  model: ChatModel
  onModelChange: (value: ChatModel) => void
  effort: ChatEffort
  onEffortChange: (value: ChatEffort) => void
  onAccessChange?: (value: ChatAccess) => void
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
  onAccessChange,
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
  const [accessOpen, setAccessOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const blocked = disabled
  const visibleAccessOptions = ACCESS_OPTIONS.filter((option) =>
    capabilities.accessOptions.includes(option.value),
  )
  const visibleModelOptions = MODEL_OPTIONS.filter((option) =>
    capabilities.availableModels.includes(option.value),
  )
  const showAccessMode = visibleAccessOptions.length > 0
  return (
    <div className="flex min-w-0 items-center gap-2">
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
      {showAccessMode ? (
        <Popover open={accessOpen} onOpenChange={setAccessOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                disabled={blocked}
                className="app-interactive inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-sm font-medium text-app-access-mode disabled:pointer-events-none"
              />
            }
          >
            <ShieldAlertIcon className="size-4.5" />
            <span className="truncate">{labelFor(ACCESS_OPTIONS, capabilities.access)}</span>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-56 border-app-border bg-app-surface-raised p-1 text-foreground"
            role="listbox"
            aria-label="Permission mode"
          >
            {visibleAccessOptions.map((option) => (
              <OptionButton
                key={option.value}
                selected={option.value === capabilities.access}
                onClick={() => {
                  onAccessChange?.(option.value)
                  setAccessOpen(false)
                }}
              >
                {option.label}
              </OptionButton>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      {collaborationMode === 'plan' ? (
        <button
          type="button"
          onClick={() => onCollaborationModeChange?.('default')}
          className="app-interactive group inline-flex cursor-pointer items-center gap-2 rounded-full px-2 py-1 text-sm text-muted-foreground"
        >
          <span className="relative flex size-4 items-center justify-center">
            <Lightbulb className="absolute inset-0 size-4 group-hover:opacity-0" />
            <X className="absolute inset-0 size-4 opacity-0 group-hover:opacity-100" />
          </span>
          <span>Plan</span>
        </button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {capabilities.contextUsage ? (
          <HoverCard>
            <HoverCardTrigger
              delay={100}
              closeDelay={100}
              render={
                <button
                  type="button"
                  className="app-interactive inline-flex size-4 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={
                    contextUsagePercent(tokenUsage, contextWindow) === null
                      ? 'Context window unavailable'
                      : `${contextUsagePercent(tokenUsage, contextWindow)}% context used`
                  }
                />
              }
            >
              <ContextUsageIndicator usage={tokenUsage} contextWindow={contextWindow} />
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              sideOffset={12}
              className="flex w-fit flex-col items-center gap-1 rounded-3xl border-app-border bg-app-surface-raised p-4 text-center shadow-[0_2px_12px_var(--app-shadow)]"
            >
              <p className="font-medium text-app-text-muted">Context window:</p>
              <p className="font-medium text-foreground">
                {formatContextUsage(tokenUsage, contextWindow)}
              </p>
              <p className="font-medium text-foreground">
                {formatTokenTotals(tokenUsage, contextWindow)}
              </p>
            </HoverCardContent>
          </HoverCard>
        ) : null}
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                disabled={blocked}
                className="app-interactive inline-flex h-8 min-w-0 items-center gap-2 rounded-full px-2.5 text-sm text-app-text-muted hover:text-foreground disabled:pointer-events-none"
              />
            }
          >
            <span className="truncate">
              {labelFor(MODEL_OPTIONS, model)} {labelFor(EFFORT_OPTIONS, effort)}
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
                <span
                  key={option.value}
                  title={
                    capabilities.disabledModels.includes(option.value)
                      ? capabilities.disabledModelMessage
                      : undefined
                  }
                >
                  <OptionButton
                    selected={option.value === model}
                    selectedBackground={false}
                    disabled={capabilities.disabledModels.includes(option.value)}
                    onClick={() => {
                      if (capabilities.disabledModels.includes(option.value)) return
                      onModelChange(option.value)
                      setModelOpen(false)
                    }}
                  >
                    {option.label}
                  </OptionButton>
                </span>
              ))}
            </div>
            <div className="px-1">
              <Separator />
            </div>
            <div role="group" aria-label="Reasoning effort">
              {EFFORT_OPTIONS.map((option) => {
                const effortDisabled = capabilities.disabledEfforts.includes(option.value)
                return (
                  <span
                    key={option.value}
                    title={effortDisabled ? capabilities.disabledEffortMessage : undefined}
                  >
                    <OptionButton
                      selected={option.value === effort}
                      disabled={effortDisabled}
                      onClick={() => {
                        if (effortDisabled) return
                        onEffortChange(option.value)
                        setModelOpen(false)
                      }}
                    >
                      {option.label}
                    </OptionButton>
                  </span>
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
        className="absolute inset-0 size-4 stroke-app-text-subtle stroke-3"
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
