import {
  fenceCode,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
  type MarkdownInputBlock,
} from './chat-input-markdown'
import { countLogicalLines } from './paste-code-detection'
import type { ComposerSkill } from '@/app/chat/model/composer-types'

export const MAX_MESSAGE_LENGTH = 100_000
const CARD_LINE_THRESHOLD = 100
const CARD_CHARACTER_THRESHOLD = 5_000

export type InputBlock =
  | { id: string; kind: 'text' | 'code'; text: string }
  | { id: string; kind: 'skill'; skill: ComposerSkill }
export type CodeSnippetAttachment = {
  id: string
  text: string
  title: string
  lineCount: number
  characterCount: number
}
export type InputDraft = { blocks: InputBlock[]; attachments: CodeSnippetAttachment[] }
let inputId = 0

export const createInputId = () => `chat-input-${++inputId}`

export function shouldUseCard(text: string) {
  return countLogicalLines(text) > CARD_LINE_THRESHOLD || text.length > CARD_CHARACTER_THRESHOLD
}

export function createAttachment(text: string): CodeSnippetAttachment {
  const firstLine = text
    .split(/\r\n?|\n/)
    .find((line) => line.trim())
    ?.trim()
  return {
    id: createInputId(),
    text,
    title: firstLine ? firstLine.slice(0, 120) : 'Code snippet',
    lineCount: countLogicalLines(text),
    characterCount: text.length,
  }
}

export function parseDraft(source: string, skills: readonly ComposerSkill[] = []): InputDraft {
  const blocks: InputBlock[] = []
  const attachments: CodeSnippetAttachment[] = []
  for (const block of parseMarkdownBlocks(source)) {
    if (block.kind === 'code' && shouldUseCard(block.text))
      attachments.push(createAttachment(block.text))
    else if (block.kind === 'skill') {
      const matches = Array.from(
        new Map(
          skills
            .filter((skill) => skill.name === block.name && skill.scope === block.scope)
            .map((skill) => [skill.handle, skill]),
        ).values(),
      )
      if (matches.length === 1)
        blocks.push({ id: createInputId(), kind: 'skill', skill: matches[0] })
      else
        blocks.push({ id: createInputId(), kind: 'text', text: serializeMarkdownBlocks([block]) })
    } else blocks.push({ ...block, id: createInputId() })
  }
  if (blocks.length === 0) blocks.push({ id: createInputId(), kind: 'text', text: '' })
  return { blocks, attachments }
}

export function serializeDraft(draft: InputDraft) {
  const body = serializeMarkdownBlocks(toMarkdownBlocks(draft.blocks))
  const attachments = draft.attachments.map((attachment) => fenceCode(attachment.text)).join('\n\n')
  if (!attachments) return body
  if (!body) return attachments
  const trailingNewlines = body.match(/\n+$/)?.[0].length ?? 0
  return `${body}${'\n'.repeat(Math.max(0, 2 - trailingNewlines))}${attachments}`
}

export function serializeDraftBody(draft: InputDraft) {
  return serializeMarkdownBlocks(
    toMarkdownBlocks(draft.blocks.filter((block) => block.kind !== 'skill')),
  )
}

export function draftSkills(draft: InputDraft) {
  const seen = new Set<string>()
  return draft.blocks.flatMap((block) => {
    if (block.kind !== 'skill' || seen.has(block.skill.handle)) return []
    seen.add(block.skill.handle)
    return [block.skill]
  })
}

export function toMarkdownBlocks(blocks: readonly InputBlock[]): MarkdownInputBlock[] {
  return blocks.map((block) =>
    block.kind === 'skill'
      ? { kind: 'skill', name: block.skill.name, scope: block.skill.scope }
      : block,
  )
}

export function formatCount(value: number) {
  return new Intl.NumberFormat('en', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase()
}

export function getEditorBlock(editor: HTMLDivElement, node: Node | null) {
  let element = node instanceof Element ? node : node?.parentElement
  while (element?.parentElement && element.parentElement !== editor) element = element.parentElement
  return element?.parentElement === editor ? element : null
}
