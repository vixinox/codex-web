import { describe, expect, it } from 'vitest'

import {
  fenceCode,
  parseMarkdownBlocks,
  skillMarkdownLink,
  unwrapSingleFencedCode,
} from './chat-input-markdown'
import { draftSkills, parseDraft, serializeDraft, serializeDraftBody } from './draft-model'
import { countLogicalLines, detectCodePaste } from './paste-code-detection'

describe('paste code detection', () => {
  it('trusts a validated VS Code language and ignores malformed metadata', () => {
    expect(
      detectCodePaste({
        text: 'value',
        vscodeEditorData: JSON.stringify({ version: 1, mode: 'javascript' }),
      }).codeLike,
    ).toBe(true)
    expect(detectCodePaste({ text: 'value', vscodeEditorData: '{' }).codeLike).toBe(false)
  })

  it('detects structured code and rejects prose and markdown', () => {
    expect(
      detectCodePaste({
        text: 'import { readFile } from "node:fs"\n\nexport function load(path) {\n  return readFile(path)\n}',
      }).codeLike,
    ).toBe(true)
    expect(
      detectCodePaste({
        text: 'This is a normal paragraph with enough words to explain a feature.\nIt should remain normal prose when pasted.',
      }).codeLike,
    ).toBe(false)
    expect(detectCodePaste({ text: '# Notes\n- first item\n- second item' }).codeLike).toBe(false)
  })

  it('uses editor HTML as evidence and treats copy metadata as only a weak hint', () => {
    const html = [
      '<div style="white-space: pre">',
      '<div><span style="color: #c586c0">const</span> value = 1;</div>',
      '<div><span style="color: #569cd6">return</span> value;</div>',
      '</div>',
    ].join('')
    expect(detectCodePaste({ text: 'value one\nvalue two', html })).toMatchObject({
      codeLike: true,
      reason: 'editor-html',
    })
    expect(
      detectCodePaste({
        text: 'This remains ordinary text.',
        vscodeCopyMetadata: JSON.stringify({ isFromEmptySelection: false }),
      }).codeLike,
    ).toBe(false)
  })

  it('unwraps one explicit fence but not a mixed markdown document', () => {
    expect(detectCodePaste({ text: '```js\nconst answer = 42\n```' })).toMatchObject({
      codeLike: true,
      text: 'const answer = 42',
      reason: 'fence',
    })
    expect(unwrapSingleFencedCode('Before\n```js\nconst answer = 42\n```')).toBeUndefined()
  })

  it('counts a terminal newline without inventing an extra logical line', () => {
    expect(countLogicalLines('one\r\ntwo\r\n')).toBe(2)
    expect(countLogicalLines('')).toBe(1)
  })
})

describe('markdown input fences', () => {
  it('uses a longer fence when the code contains backticks and parses it back', () => {
    const code = 'const markdown = "```js\\nvalue\\n```"'
    const fenced = fenceCode(code)
    expect(fenced.startsWith('````\n')).toBe(true)
    expect(parseMarkdownBlocks(fenced)).toEqual([{ kind: 'code', text: code }])
  })

  it('preserves text and line breaks around a fenced block', () => {
    const source = 'Before\n```js\nconst answer = 42\n```\nAfter'
    expect(parseMarkdownBlocks(source)).toEqual([
      { kind: 'text', text: 'Before\n' },
      { kind: 'code', text: 'const answer = 42' },
      { kind: 'text', text: '\nAfter' },
    ])
  })

  it('round trips safe Skill links without parsing links inside code fences', () => {
    const pdf = {
      handle: 'pdf-user',
      name: 'pdf export',
      displayName: 'PDF export',
      description: 'Create PDFs',
      scope: 'user' as const,
    }
    const source = [
      `Use ${skillMarkdownLink(pdf.name, pdf.scope)} now.`,
      '```md',
      skillMarkdownLink(pdf.name, pdf.scope),
      '```',
    ].join('\n')

    const draft = parseDraft(source, [pdf])
    expect(draft.blocks.map((block) => block.kind)).toEqual(['text', 'skill', 'text', 'code'])
    expect(draftSkills(draft)).toEqual([pdf])
    expect(serializeDraft(draft)).toBe(
      `Use ${skillMarkdownLink(pdf.name, pdf.scope)} now.\n\`\`\`\n${skillMarkdownLink(pdf.name, pdf.scope)}\n\`\`\``,
    )
    expect(serializeDraftBody(draft)).toBe(
      'Use  now.\n```\n[$pdf export](skill://user/pdf%20export)\n```',
    )
  })

  it('only converts a unique available Skill link and leaves unsafe paths as text', () => {
    const userPdf = {
      handle: 'pdf-user',
      name: 'pdf',
      displayName: 'PDF',
      description: 'Create PDFs',
      scope: 'user' as const,
    }
    const repoPdf = { ...userPdf, handle: 'pdf-repo', scope: 'repo' as const }
    expect(
      parseDraft(skillMarkdownLink('pdf', 'repo'), [userPdf, repoPdf]).blocks[0],
    ).toMatchObject({
      kind: 'skill',
      skill: repoPdf,
    })
    expect(parseDraft('[$pdf](C:\\private\\SKILL.md)', [userPdf]).blocks[0]).toMatchObject({
      kind: 'text',
      text: '[$pdf](C:\\private\\SKILL.md)',
    })
    expect(
      parseDraft(skillMarkdownLink('pdf', 'user'), [
        { ...userPdf, handle: 'one' },
        { ...userPdf, handle: 'two' },
      ]).blocks[0],
    ).toMatchObject({
      kind: 'text',
    })
  })
})
