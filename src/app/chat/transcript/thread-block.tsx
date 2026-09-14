import * as React from 'react'
import {
  AlertCircleIcon,
  ChevronRightIcon,
  ListCollapseIcon,
  PencilIcon,
  WifiIcon,
} from 'lucide-react'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MessageContent } from '@/app/chat/content/message-content'
import { ShikiCodeBlock } from '@/app/chat/content/shiki-code-block'
import { detectShellLanguage, formatDisplayedCommand, trimBlankEdgeLines } from './activity-code'
import { StreamingAssistant } from './streaming-assistant'
import { countDiffLines } from '@/app/chat/native/diff-stats'
import type { ChatActivity, ChatActivityKind, ChatBlock } from '@/app/chat/model/types'
import { formatDuration } from './formatting'
import { fileName, redactAbsoluteDiffHeaderPaths, shortestUniquePathSuffixes } from './file-paths'
import { ActivityIcon } from './activity-icon'
import { TranscriptCollapsibleContent } from './transcript-collapsible'

export function ThreadBlock({
  block,
  streaming = false,
  animate = false,
  onAssistantSettled,
}: {
  block: ChatBlock
  streaming?: boolean
  animate?: boolean
  onAssistantSettled?: () => void
}) {
  if (block.type === 'assistant')
    return (
      <div className="text-sm leading-6 text-foreground">
        <StreamingAssistant
          text={block.text}
          flush={!streaming}
          animate={animate}
          onSettled={onAssistantSettled}
        />
      </div>
    )
  if (block.type === 'article')
    return (
      <div className="flex items-center gap-2 text-sm text-app-text-subtle select-none">
        <ListCollapseIcon className="size-3.5 shrink-0" />
        <span>{block.title}</span>
      </div>
    )
  if (block.type === 'error')
    return (
      <div className="flex items-start gap-2 text-xs text-destructive" role="alert">
        <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>{block.message}</span>
      </div>
    )
  if (block.type === 'user')
    return (
      <div className="my-1 ml-auto max-w-[85%] rounded-2xl bg-app-surface-raised px-4 py-2 text-sm text-foreground">
        <UserContent content={block.content} />
      </div>
    )
  if (block.kind === 'file') return <FileActivityBlock block={block} />
  if (block.activities.length > 1) return <ActivityBatch block={block} />
  return (
    <div className="flex flex-col gap-0.5">
      {block.activities.map((item) => (
        <ActivityRow key={item.id} item={item} />
      ))}
    </div>
  )
}

function ActivityBatch({ block }: { block: Extract<ChatBlock, { type: 'activity' }> }) {
  const hasRunningActivity = block.activities.some((item) => item.status === 'running')
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    if (!hasRunningActivity) return
    queueMicrotask(() => setOpen(true))
  }, [hasRunningActivity])
  const label =
    block.kind === 'command'
      ? 'Ran commands'
      : block.kind === 'file'
        ? 'Changed files'
        : block.kind === 'search'
          ? 'Searched the web'
          : block.kind === 'agent'
            ? 'Used agents'
            : block.kind === 'tool'
              ? 'Called tools'
              : `${block.activities.length} activities`
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="min-w-0 text-xs">
        <CollapsibleTrigger className="group inline-flex min-h-6 max-w-full items-center gap-2 text-app-text-muted hover:text-foreground">
          <ActivityIcon kind={block.kind} />
          <span className="truncate">{label}</span>
          <ChevronRightIcon
            className={`size-3.5 transition-[opacity,transform] ${open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          />
        </CollapsibleTrigger>
        <TranscriptCollapsibleContent>
          <div className="min-h-0 overflow-hidden pl-5">
            {block.activities.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        </TranscriptCollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function UserContent({
  content,
}: {
  content: Extract<ChatBlock, { type: 'user' }>['content']
}) {
  return (
    <div className="flex flex-col gap-1">
      {content.map((item, index) =>
        item.type === 'text' ? (
          <MessageContent key={index} text={item.text} markdown={false} />
        ) : item.type === 'codeSnippet' ? null : (
          <span key={index} className="text-xs text-app-text-muted">
            {item.type === 'attachment'
              ? `${item.kind === 'image' ? 'Image' : 'Audio'}: ${item.label}`
              : `${item.kind === 'skill' ? 'Skill' : 'Mention'}: ${item.label}`}
          </span>
        ),
      )}
    </div>
  )
}

export function LiveRow({
  label,
  kind,
  network,
}: {
  label: string
  kind?: ChatActivityKind
  network?: boolean
}) {
  return (
    <div
      className="inline-flex min-h-8 max-w-full items-center gap-2 text-xs text-app-text-muted select-none"
      role="status"
    >
      {network ? (
        <WifiIcon className="size-3.5 shrink-0" />
      ) : kind ? (
        <ActivityIcon kind={kind} />
      ) : null}
      <span className="thinking-shimmer w-fit truncate text-sm mt-1">{label}</span>
    </div>
  )
}

const commandResultLabels: Record<NonNullable<ChatActivity['commandStatus']>, string> = {
  completed: 'Success',
  failed: 'Failed',
  declined: 'Declined',
  interrupted: 'Interrupted',
}

function ActivityRow({ item }: { item: ChatActivity }) {
  const [open, setOpen] = React.useState(false)
  const output = item.output ? trimBlankEdgeLines(item.output) : undefined
  const details = item.command || item.detail || item.meta || output || searchActivityDetails(item)
  const command = item.command ? formatDisplayedCommand(item.command) : undefined
  const label = formatActivityLabel(item, command)
  const code = [command, output].filter(Boolean).join('\n')
  const commandResult =
    item.commandStatus !== undefined
      ? commandResultLabels[item.commandStatus]
      : item.kind === 'command' && item.exitCode !== undefined
        ? `Exit code ${item.exitCode}`
        : undefined
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group min-w-0 text-xs">
        <CollapsibleTrigger
          className="inline-flex min-h-6 max-w-full items-center gap-2 text-left text-app-text-muted hover:text-foreground"
          disabled={!details}
        >
          <ActivityIcon kind={item.kind} />
          <span className="truncate">{label}</span>
          {details ? (
            <ChevronRightIcon
              className={`size-3.5 transition-[opacity,transform] ${open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            />
          ) : null}
        </CollapsibleTrigger>
        {details ? (
          <TranscriptCollapsibleContent>
            <div className="min-h-0 overflow-hidden">
              {code ? (
                <ShikiCodeBlock
                  code={code}
                  language={command ? detectShellLanguage(command) : 'text'}
                  copy={false}
                  className="my-1"
                  contentClassName="max-h-56"
                  footer={
                    commandResult ? (
                      <span className="px-1.5 py-0.5 text-xs leading-4 text-app-text-subtle">
                        {commandResult}
                      </span>
                    ) : undefined
                  }
                />
              ) : null}
              {item.detail ? <div className="text-app-text-subtle">{item.detail}</div> : null}
              {searchActivityDetails(item) ? (
                <div className="whitespace-pre-wrap text-app-text-subtle">
                  {searchActivityDetails(item)}
                </div>
              ) : null}
              {item.meta ? <div className="text-app-text-subtle/75">{item.meta}</div> : null}
              {item.truncated ? (
                <div className="text-app-text-subtle">Content was truncated.</div>
              ) : null}
            </div>
          </TranscriptCollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  )
}

function FileActivityBlock({ block }: { block: Extract<ChatBlock, { type: 'activity' }> }) {
  const fileChanges = block.activities.flatMap((activity) =>
    (activity.changes ?? []).map((change, index) => ({
      id: `${activity.id}-${change.path}-${index}`,
      change,
    })),
  )
  const displayPaths = shortestUniquePathSuffixes(
    fileChanges.flatMap(({ change }) => [
      change.path,
      ...(change.movePath ? [change.movePath] : []),
    ]),
  )
  const files = fileChanges.map(({ id, change }) => ({
    id,
    change,
    displayPath: displayPaths.get(change.path) ?? fileName(change.path),
    displayMovePath: change.movePath
      ? (displayPaths.get(change.movePath) ?? fileName(change.movePath))
      : undefined,
  }))
  const aggregatedDiffs = block.activities.flatMap((activity) =>
    activity.aggregatedDiff
      ? [{ id: `${activity.id}-aggregated`, diff: activity.aggregatedDiff }]
      : [],
  )
  const childCount = files.length + aggregatedDiffs.length
  const children = childCount ? (
    <div className="flex min-w-0 flex-col">
      {files.map(({ id, change, displayPath, displayMovePath }) => (
        <FileChangeRow
          key={id}
          change={change}
          displayPath={displayPath}
          displayMovePath={displayMovePath}
        />
      ))}
      {aggregatedDiffs.map(({ id, diff }) => (
        <AggregatedDiffRow key={id} diff={diff} />
      ))}
    </div>
  ) : null
  const [open, setOpen] = React.useState(true)
  return (
    <div className="min-w-0 text-xs">
      {childCount > 1 ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="group inline-flex min-h-6 max-w-full items-center gap-2 text-app-text-muted hover:text-foreground">
            <ActivityIcon kind="file" />
            <span className="truncate">Changed files</span>
            <ChevronRightIcon
              className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
            />
          </CollapsibleTrigger>
          <TranscriptCollapsibleContent>
            <div className="min-h-0 overflow-hidden pl-5">{children}</div>
          </TranscriptCollapsibleContent>
        </Collapsible>
      ) : childCount === 1 ? (
        children
      ) : (
        <div className="flex flex-col gap-0.5">
          {block.activities.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function FileChangeRow({
  change,
  displayPath,
  displayMovePath,
}: {
  change: NonNullable<ChatActivity['changes']>[number]
  displayPath: string
  displayMovePath?: string
}) {
  const [open, setOpen] = React.useState(false)
  const label = `${formatChangeKind(change.kind)} ${displayPath}${displayMovePath ? ` -> ${displayMovePath}` : ''}`
  const stats = countDiffLines(change.diff)
  const statsLabel = formatDiffStats(stats)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="group inline-flex min-h-6 max-w-full items-center gap-1.5 text-left text-app-text-muted hover:text-foreground"
        disabled={!change.diff}
      >
        <PencilIcon className="size-3.5 shrink-0 text-app-text-subtle" />
        <span className="truncate">{label}</span>
        {statsLabel ? <span className="shrink-0 text-app-text-subtle">{statsLabel}</span> : null}
        {change.diff ? (
          <ChevronRightIcon
            className={`size-3.5 shrink-0 transition-[opacity,transform] ${open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          />
        ) : null}
      </CollapsibleTrigger>
      {change.diff ? (
        <TranscriptCollapsibleContent>
          <ShikiCodeBlock
            code={redactAbsoluteDiffHeaderPaths(change.diff)}
            language="diff"
            label={displayPath}
            copy={false}
            className="my-1"
            contentClassName="max-h-72"
          />
        </TranscriptCollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

function AggregatedDiffRow({ diff }: { diff: string }) {
  const [open, setOpen] = React.useState(false)
  const statsLabel = formatDiffStats(countDiffLines(diff))
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group inline-flex min-h-6 max-w-full items-center gap-1.5 text-left text-app-text-muted hover:text-foreground">
        <span className="truncate">Aggregated diff</span>
        {statsLabel ? <span className="shrink-0 text-app-text-subtle">{statsLabel}</span> : null}
        <ChevronRightIcon
          className={`size-3.5 shrink-0 transition-[opacity,transform] ${open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        />
      </CollapsibleTrigger>
      <TranscriptCollapsibleContent>
        <ShikiCodeBlock
          code={redactAbsoluteDiffHeaderPaths(diff)}
          language="diff"
          label="diff"
          copy={false}
          className="my-1"
          contentClassName="max-h-72"
        />
      </TranscriptCollapsibleContent>
    </Collapsible>
  )
}

function formatChangeKind(kind: string) {
  if (kind === 'add') return 'Added'
  if (kind === 'update') return 'Edited'
  if (kind === 'delete') return 'Deleted'
  if (kind === 'move') return 'Moved'
  return kind ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}` : 'Changed'
}

function formatActivityLabel(item: ChatActivity, displayedCommand = item.command ?? item.title) {
  if (item.kind === 'search' && item.searchAction) {
    if (item.searchAction.type === 'openPage') return 'Opened page'
    if (item.searchAction.type === 'findInPage') return 'Found in page'
  }
  if (item.kind !== 'command')
    return item.status === 'running' ? `Running ${item.title}` : item.title
  const command = displayedCommand
  if (item.status === 'running') return `Running ${command}`
  const duration =
    item.durationMs === undefined ? '' : ` in ${formatActivityDuration(item.durationMs)}`
  return item.command ? `Ran ${command}${duration}` : `${command}${duration}`
}

function searchActivityDetails(item: ChatActivity) {
  const action = item.searchAction
  if (!action) return undefined
  if (action.type === 'search')
    return [action.query, ...(action.queries ?? [])].filter(Boolean).join('\n')
  if (action.type === 'openPage') return action.url
  return [action.url, action.pattern].filter(Boolean).join('\n') || undefined
}

function formatActivityDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))}ms`
  const seconds = Math.round(durationMs / 1_000)
  return seconds < 60 ? `${seconds}s` : formatDuration(durationMs)
}

function formatDiffStats(stats: ReturnType<typeof countDiffLines>) {
  return [
    stats.additions ? `+${stats.additions}` : '',
    stats.deletions ? `-${stats.deletions}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
