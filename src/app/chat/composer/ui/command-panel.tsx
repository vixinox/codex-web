import { Blocks, CheckIcon, CircleIcon, Lightbulb, RefreshCwIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ComposerSkill, SkillPickerViewModel } from '@/app/chat/model/composer-types'

const COMMANDS = [
  {
    command: 'Compact',
    icon: <CircleIcon className="size-4 fill-app-surface-raised stroke-app-text-subtle stroke-3" />,
    description: "Compact the this chat's content",
  },
  { command: 'Plan mode', icon: <Lightbulb />, description: 'Plan before making changes' },
]

function matchesQuery(query: string, ...values: string[]) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return (
    !normalizedQuery || values.some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  )
}

export function CommandPanel({
  query,
  trigger,
  disabled = false,
  onCompact,
  onPlan,
  skills,
  selectedSkills,
  onSkillSelect,
  onRetrySkills,
}: {
  query: string
  trigger: '/' | '@'
  disabled?: boolean
  onCompact?: () => void
  onPlan?: () => void
  skills: SkillPickerViewModel
  selectedSkills: readonly Pick<ComposerSkill, 'name' | 'scope'>[]
  onSkillSelect: (skill: ComposerSkill) => void
  onRetrySkills: () => void
}) {
  const commands =
    trigger === '/'
      ? COMMANDS.filter((item) => matchesQuery(query, item.command, item.description))
      : []
  const matchingSkills = skills.items.filter((item) =>
    matchesQuery(query, item.name, item.displayName, item.description),
  )
  return (
    <div
      data-command-panel
      className="mb-2 flex max-h-[min(24rem,calc(100vh-10rem))] w-full flex-col overflow-hidden rounded-3xl border border-app-border bg-app-surface-raised p-1.5 text-app-text-muted shadow-[0_2px_12px_var(--app-shadow)]"
    >
      <div className="min-h-0 [scrollbar-color:var(--app-border-strong)_transparent] overflow-y-auto pr-1 text-sm [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-app-border-strong [&::-webkit-scrollbar-track]:bg-transparent">
        {commands.length > 0 ? (
          <div>
            {commands.map((item) => (
              <CommandItem
                key={item.command}
                {...item}
                disabled={disabled}
                onSelect={item.command === 'Plan mode' ? onPlan : onCompact}
              />
            ))}
          </div>
        ) : null}

        <div className={commands.length > 0 ? 'mt-4' : undefined}>
          <p className="mb-1 px-2 font-medium text-app-text-subtle">Skills</p>
          {skills.status === 'loading' ? (
            <p className="px-2 py-1.5 text-sm text-app-text-muted">Loading skills</p>
          ) : null}
          {skills.status === 'error' ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-app-text-muted">
              <span className="min-w-0 flex-1 truncate">{skills.message}</span>
              <button
                type="button"
                className="app-interactive inline-flex size-7 shrink-0 items-center justify-center rounded-md"
                aria-label="Retry loading skills"
                onClick={onRetrySkills}
                disabled={disabled}
              >
                <RefreshCwIcon className="size-4" />
              </button>
            </div>
          ) : null}
          {skills.status === 'ready' && matchingSkills.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-app-text-muted">
              {skills.items.length === 0 ? 'No skills available' : 'No matching skills'}
            </p>
          ) : null}
          {matchingSkills.map((item) => (
            <SkillItem
              key={item.handle}
              skill={item}
              selected={selectedSkills.some(
                (selected) => selected.name === item.name && selected.scope === item.scope,
              )}
              disabled={disabled}
              onSelect={onSkillSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function CommandItem({
  command,
  icon,
  description,
  disabled,
  onSelect,
}: {
  command: string
  icon: ReactNode
  description: string
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      data-command-item
      disabled={disabled}
      onClick={onSelect}
      className="app-interactive flex w-full items-center gap-4 rounded-xl px-2 py-1.5 text-left select-none disabled:pointer-events-none disabled:opacity-50"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-4 shrink-0 items-center justify-center text-app-text-muted [&>svg]:size-4">
          {icon}
        </span>
        <span className="truncate text-foreground">{command}</span>
      </div>
      <span className="max-w-[58%] truncate text-right text-app-text-subtle">{description}</span>
    </button>
  )
}

function SkillItem({
  skill,
  selected,
  disabled,
  onSelect,
}: {
  skill: ComposerSkill
  selected: boolean
  disabled: boolean
  onSelect: (skill: ComposerSkill) => void
}) {
  return (
    <button
      type="button"
      data-command-item
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(skill)}
      className="app-interactive flex w-full items-center gap-4 rounded-xl px-2 py-1.5 text-left select-none disabled:pointer-events-none disabled:opacity-50"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Blocks className="flex size-4 shrink-0 items-center justify-center" />
        <span className="truncate text-foreground">{skill.displayName}</span>
      </div>
      <span className="flex max-w-[58%] min-w-0 items-center gap-2 text-right text-app-text-subtle">
        <span className="truncate">{skill.description}</span>
        <span className="shrink-0 text-xs">{skill.scope}</span>
        {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
      </span>
    </button>
  )
}
