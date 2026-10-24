export type MarkdownInputBlock =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'skill'; name: string; scope: SkillScope }

export type SkillScope = 'user' | 'repo' | 'system' | 'admin'

const SKILL_SCOPES = new Set<SkillScope>(['user', 'repo', 'system', 'admin'])
const SKILL_LINK_PATTERN = /\[\$([^\]\r\n]+)\]\(skill:\/\/([^/\r\n)]+)\/([^\r\n)]+)\)/g

function longestBacktickRun(text: string) {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return longest
}

export function fenceCode(text: string) {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1))
  return `${fence}\n${text}\n${fence}`
}

export function serializeMarkdownBlocks(blocks: readonly MarkdownInputBlock[]) {
  return blocks
    .map((block) => {
      if (block.kind === 'code') return fenceCode(block.text)
      if (block.kind === 'skill') return skillMarkdownLink(block.name, block.scope)
      return block.text
    })
    .join('')
}

export function skillMarkdownLink(name: string, scope: SkillScope) {
  return `[$${name}](skill://${scope}/${encodeURIComponent(name)})`
}

export function parseMarkdownBlocks(source: string): MarkdownInputBlock[] {
  const blocks: MarkdownInputBlock[] = []
  const openingPattern = /^(`{3,})[^\r\n]*\r?\n/gm
  let cursor = 0
  let opening: RegExpExecArray | null

  while ((opening = openingPattern.exec(source))) {
    const fenceLength = opening[1].length
    const bodyStart = opening.index + opening[0].length
    const closingPattern = new RegExp('^`{' + fenceLength + ',}[ \\t]*(?=\\r?$)', 'gm')
    closingPattern.lastIndex = bodyStart
    const closing = closingPattern.exec(source)
    if (!closing) continue

    if (opening.index > cursor) appendTextBlocks(blocks, source.slice(cursor, opening.index))
    let bodyEnd = closing.index
    if (source[bodyEnd - 1] === '\n') bodyEnd -= 1
    if (source[bodyEnd - 1] === '\r') bodyEnd -= 1
    blocks.push({ kind: 'code', text: source.slice(bodyStart, bodyEnd) })
    cursor = closing.index + closing[0].length
    openingPattern.lastIndex = cursor
  }

  if (cursor < source.length || blocks.length === 0) appendTextBlocks(blocks, source.slice(cursor))
  return blocks
}

function appendTextBlocks(blocks: MarkdownInputBlock[], text: string) {
  let cursor = 0
  SKILL_LINK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SKILL_LINK_PATTERN.exec(text))) {
    const name = match[1]
    const scope = match[2]
    const encodedName = match[3]
    if (!isSkillScope(scope) || encodedName !== encodeURIComponent(name)) continue
    if (match.index > cursor) blocks.push({ kind: 'text', text: text.slice(cursor, match.index) })
    blocks.push({ kind: 'skill', name, scope })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length || text.length === 0)
    blocks.push({ kind: 'text', text: text.slice(cursor) })
}

function isSkillScope(value: string): value is SkillScope {
  return SKILL_SCOPES.has(value as SkillScope)
}

export function unwrapSingleFencedCode(source: string) {
  const blocks = parseMarkdownBlocks(source)
  return blocks.length === 1 && blocks[0].kind === 'code' ? blocks[0].text : undefined
}
