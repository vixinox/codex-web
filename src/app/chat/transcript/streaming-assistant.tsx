import * as React from 'react'
import { MessageContent } from '@/app/chat/content/message-content'
import { useGsapEnter } from '@/lib/platform/browser/use-gsap-enter'
import { repairInterruptedCodeFence } from './markdown-repair'

type MarkdownBlock = { id: string; text: string }

/**
 * Keep the incomplete tail out of the DOM. Blocks are deliberately conservative:
 * a block is committed only after a blank-line boundary and balanced inline syntax.
 */
export function splitCompleteMarkdownBlocks(text: string, flush = false) {
  const lines = text.split(/(\r?\n)/)
  const blocks: MarkdownBlock[] = []
  let current = ''
  let inFence: { marker: '`' | '~'; length: number } | undefined

  const commit = () => {
    const candidate = current.trimEnd()
    if (!candidate || !isCompleteMarkdownBlock(candidate)) return false
    blocks.push({ id: `markdown-${blocks.length}`, text: candidate })
    current = ''
    return true
  }

  for (let index = 0; index < lines.length; index += 1) {
    const part = lines[index]
    current += part
    if (!part.match(/\r?\n/)) continue

    const line = current.split(/\r?\n/).at(-2) ?? ''
    const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const marker = fence[2][0] as '`' | '~'
      const length = fence[2].length
      const suffix = fence[3] ?? ''
      if (!inFence) {
        if (!(marker === '`' && suffix.includes('`'))) inFence = { marker, length }
      } else if (marker === inFence.marker && length >= inFence.length && !suffix.trim()) {
        inFence = undefined
      }
    }

    if (!inFence && /^\s*$/.test(line)) commit()
  }

  if (flush && current.trim()) {
    const repaired = repairInterruptedCodeFence(current.trimEnd())
    if (isCompleteMarkdownBlock(repaired, true)) {
      blocks.push({ id: `markdown-${blocks.length}`, text: repaired })
      current = ''
    }
  }

  return { blocks, pending: current }
}

function isCompleteMarkdownBlock(text: string, allowRepairedFence = false) {
  if (!allowRepairedFence && hasUnclosedFence(text)) return false

  const withoutFences = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
  const strong = (withoutFences.match(/(?<!\\)(\*\*|__)/g) ?? []).length
  if (strong % 2 !== 0) return false

  const withoutStrong = withoutFences.replace(/(?<!\\)(\*\*|__)/g, '')
  const withoutListMarkers = withoutStrong
    .replace(/^\s{0,3}[*+-]\s+/gm, '')
    .replace(/^\s{0,3}[*_-]{3,}\s*$/gm, '')
  const emphasis = withoutListMarkers.match(/(?<!\\)(?<!\w)[*_](?!\s)/g)?.length ?? 0
  if (emphasis % 2 !== 0) return false

  const codeSpans = (withoutFences.match(/(?<!\\)`/g) ?? []).length
  if (codeSpans % 2 !== 0) return false

  const openLinks = (withoutFences.match(/(?<!\\)\[/g) ?? []).length
  const closeLinks = (withoutFences.match(/(?<!\\)\]/g) ?? []).length
  if (openLinks !== closeLinks || /\[[^\]]*\]\([^)]*$/.test(withoutFences)) return false

  return true
}

function hasUnclosedFence(text: string) {
  let open: { marker: '`' | '~'; length: number } | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) continue
    const marker = match[2][0] as '`' | '~'
    const length = match[2].length
    const suffix = match[3] ?? ''
    if (!open) {
      if (!(marker === '`' && suffix.includes('`'))) open = { marker, length }
    } else if (marker === open.marker && length >= open.length && !suffix.trim()) {
      open = undefined
    }
  }
  return Boolean(open)
}

const MarkdownBlockView = React.memo(function MarkdownBlockView({
  block,
  animate,
  onComplete,
}: {
  block: MarkdownBlock
  animate: boolean
  onComplete?: () => void
}) {
  const ref = useGsapEnter<HTMLDivElement>([animate, block.id], {
    duration: 0.3,
    y: 4,
    onComplete,
  })

  const content = <MessageContent text={block.text} />
  return animate ? (
    <div ref={ref} className="min-w-0">
      {content}
    </div>
  ) : (
    <div className="min-w-0">{content}</div>
  )
})

export function StreamingAssistant({
  text,
  flush = false,
  animate = true,
  onSettled,
}: {
  text: string
  flush?: boolean
  animate?: boolean
  onSettled?: () => void
}) {
  const { blocks } = React.useMemo(() => splitCompleteMarkdownBlocks(text, flush), [text, flush])
  const lastBlockId = blocks.at(-1)?.id
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {blocks.map((block) => (
        <MarkdownBlockView
          key={block.id}
          block={block}
          animate={animate}
          onComplete={block.id === lastBlockId ? onSettled : undefined}
        />
      ))}
    </div>
  )
}
