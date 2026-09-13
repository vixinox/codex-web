import * as React from 'react'
import { MessageContent } from '@/app/chat/content/message-content'
import { repairInterruptedCodeFence } from './markdown-repair'
import { gsap } from 'gsap'
import { transcriptDebug } from './transcript-debug'

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
  transcriptDebug({
    phase: 'split',
    blockCount: blocks.length,
    pendingLength: current.length,
    preview: false,
  })
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
  const ref = React.useRef<HTMLDivElement>(null)
  const animatedRef = React.useRef(false)
  const onCompleteRef = React.useRef(onComplete)
  onCompleteRef.current = onComplete
  React.useLayoutEffect(() => {
    if (!animate || animatedRef.current) return undefined
    const root = ref.current
    if (!root) return undefined
    animatedRef.current = true
    transcriptDebug({ phase: 'gsap', elementCount: 1, settled: false })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(root, { opacity: 1 })
      transcriptDebug({ phase: 'gsap', elementCount: 1, settled: true })
      onCompleteRef.current?.()
      return undefined
    }
    const context = gsap.context(() => {
      gsap.fromTo(
        root,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.3,
          ease: 'power2.out',
          overwrite: 'auto',
          onComplete: () => {
            transcriptDebug({ phase: 'gsap', elementCount: 1, settled: true })
            onCompleteRef.current?.()
          },
        },
      )
    }, root)
    return () => {
      animatedRef.current = false
      context.revert()
    }
  }, [animate, block.id])

  const content = <MessageContent text={block.text} />
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
  onSettled,
}: {
  text: string
  flush?: boolean
  animate?: boolean
  onSettled?: () => void
}) {
  const split = React.useMemo(() => splitCompleteMarkdownBlocks(text, flush), [text, flush])
  const blocks = split.blocks
  const settledBlockIdsRef = React.useRef(new Set<string>())
  const settleBlock = React.useCallback(
    (blockId: string) => {
      if (settledBlockIdsRef.current.has(blockId)) return
      settledBlockIdsRef.current.add(blockId)
      if (settledBlockIdsRef.current.size === blocks.length) onSettled?.()
    },
    [blocks.length, onSettled],
  )
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {blocks.map((block) => (
        <MarkdownBlockView
          key={block.id}
          block={block}
          animate={animate}
          onComplete={animate ? () => settleBlock(block.id) : undefined}
        />
      ))}
    </div>
  )
}
