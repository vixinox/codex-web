import * as React from 'react'
import { MessageContent } from '@/app/chat/content/message-content'
import { repairInterruptedCodeFence } from './markdown-repair'

type MarkdownBlock = { id: string; text: string }

/** Some model responses escape strong markers even though they intend Markdown emphasis. */
export function normalizeEscapedStrongMarkers(text: string) {
  const markers = text.match(/\\\*\\\*|\\_\\_/g) ?? []
  if (markers.length < 2 || markers.length % 2 !== 0) return text
  return text.replace(/\\\*\\\*|\\_\\_/g, (marker) => marker.slice(1, 2) + marker.slice(3, 4))
}

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
  animatedBlocks,
  onComplete,
}: {
  block: MarkdownBlock
  animate: boolean
  animatedBlocks?: Set<string>
  onComplete?: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const animatedBlockIdRef = React.useRef<string | undefined>(undefined)
  const onCompleteRef = React.useRef(onComplete)
  onCompleteRef.current = onComplete
  React.useLayoutEffect(() => {
    if (!animate) return undefined
    const root = ref.current
    if (!root) return undefined
    const alreadyStarted = animatedBlockIdRef.current === block.id
    if (!alreadyStarted && animatedBlocks?.has(block.id)) {
      onCompleteRef.current?.()
      return undefined
    }
    if (alreadyStarted && !root.classList.contains('native-markdown-enter')) {
      onCompleteRef.current?.()
      return undefined
    }
    if (!alreadyStarted && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animatedBlockIdRef.current = block.id
      animatedBlocks?.add(block.id)
      onCompleteRef.current?.()
      return undefined
    }
    if (!alreadyStarted) {
      animatedBlockIdRef.current = block.id
      animatedBlocks?.add(block.id)
      root.classList.remove('native-markdown-enter')
      void root.offsetWidth
      root.classList.add('native-markdown-enter')
    }
    const handleEnd = (event: AnimationEvent) => {
      if (event.animationName !== 'native-markdown-enter') return
      root.classList.remove('native-markdown-enter')
      onCompleteRef.current?.()
    }
    root.addEventListener('animationend', handleEnd)
    return () => {
      root.removeEventListener('animationend', handleEnd)
    }
  }, [animate, block.id, animatedBlocks])

  const content = <MessageContent text={normalizeEscapedStrongMarkers(block.text)} />
  return (
    <div ref={ref} className="min-w-0">
      {content}
    </div>
  )
})

export function StreamingAssistant({
  text,
  flush = false,
  animate = true,
  animatedBlocks,
  onSettled,
}: {
  text: string
  flush?: boolean
  animate?: boolean
  animatedBlocks?: Set<string>
  onSettled?: () => void
}) {
  const split = React.useMemo(() => splitCompleteMarkdownBlocks(text, flush), [text, flush])
  const blocks = split.blocks
  const pendingBlock =
    split.pending.trim() && isCompleteMarkdownBlock(split.pending.trim())
      ? { id: `markdown-${blocks.length}`, text: split.pending.trim() }
      : undefined
  const renderedBlocks = pendingBlock ? [...blocks, pendingBlock] : blocks
  const renderedBlockCount = renderedBlocks.length
  const settledBlockIdsRef = React.useRef(new Set<string>())
  const settleBlock = React.useCallback(
    (blockId: string) => {
      if (settledBlockIdsRef.current.has(blockId)) return
      settledBlockIdsRef.current.add(blockId)
      if (settledBlockIdsRef.current.size === renderedBlockCount) onSettled?.()
    },
    [renderedBlockCount, onSettled],
  )
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {renderedBlocks.map((block) => (
        <MarkdownBlockView
          key={block.id}
          block={block}
          animate={animate}
          animatedBlocks={animatedBlocks}
          onComplete={animate ? () => settleBlock(block.id) : undefined}
        />
      ))}
    </div>
  )
}
