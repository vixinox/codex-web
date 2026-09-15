import { CodeNode, $createCodeNode, $isCodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $isParagraphNode,
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $getNodeByKey,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  COPY_COMMAND,
  createCommand,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical'
import * as React from 'react'
import {
  parseDraft,
  serializeDraft,
  draftSkills,
  createAttachment,
  shouldUseCard,
  MAX_MESSAGE_LENGTH,
  type InputDraft,
} from './draft-model'
import type { ComposerSkill } from '@/app/chat/model/composer-types'
import { fenceCode, skillMarkdownLink } from './chat-input-markdown'
import { detectCodePaste } from './paste-code-detection'
type SerializedSkill = Spread<ComposerSkill, SerializedTextNode>
const INSERT_COMPOSER_SKILL_COMMAND = createCommand<ComposerSkill>('INSERT_COMPOSER_SKILL')
export type LexicalComposerHandle = {
  insertSkill(skill: ComposerSkill): void
  removeActiveCommand(): void
  clear(): void
}
class SkillNode extends TextNode {
  __skill: ComposerSkill
  static getType() {
    return 'composer-skill'
  }
  static clone(n: SkillNode) {
    return new SkillNode(n.__skill, n.__key)
  }
  static importJSON(n: SerializedSkill) {
    return new SkillNode({
      handle: n.handle,
      name: n.name,
      displayName: n.displayName,
      description: n.description,
      scope: n.scope,
    })
  }
  constructor(skill: ComposerSkill, key?: NodeKey) {
    super(`$${skill.name}`, key)
    this.__skill = skill
    this.setMode('token')
  }
  exportJSON(): SerializedSkill {
    return { ...super.exportJSON(), ...this.__skill, type: SkillNode.getType(), version: 1 }
  }
  createDOM(config: EditorConfig) {
    const el = super.createDOM(config)
    el.className =
      'mx-0.5 inline-block rounded-sm bg-primary/10 px-1 font-semibold text-primary select-all'
    return el
  }
  getSkill() {
    return this.getLatest().__skill
  }
}
const $createSkillNode = (s: ComposerSkill) => new SkillNode(s)
const $isSkillNode = (n: LexicalNode | null | undefined): n is SkillNode => n instanceof SkillNode
function setDraft(d: InputDraft) {
  const r = $getRoot()
  r.clear()
  let p = $createParagraphNode()
  r.append(p)
  for (const b of d.blocks) {
    if (b.kind === 'code') {
      const c = $createCodeNode()
      if (b.text) c.append($createTextNode(b.text))
      r.append(c)
      p = $createParagraphNode()
      r.append(p)
    } else if (b.kind === 'skill') p.append($createSkillNode(b.skill))
    else {
      const lines = b.text.split('\n')
      lines.forEach((line, index) => {
        if (index > 0) p.append($createLineBreakNode())
        if (line) p.append($createTextNode(line))
      })
    }
  }
}
function readDraft(a: InputDraft['attachments']): InputDraft {
  const blocks: InputDraft['blocks'] = []
  for (const n of $getRoot().getChildren()) {
    if ($isCodeNode(n)) {
      blocks.push({ id: crypto.randomUUID(), kind: 'code', text: n.getTextContent() })
      continue
    }
    if (!$isParagraphNode(n)) continue
    let t = ''
    for (const c of n.getChildren()) {
      if ($isSkillNode(c)) {
        if (t) blocks.push({ id: crypto.randomUUID(), kind: 'text', text: t })
        t = ''
        blocks.push({ id: crypto.randomUUID(), kind: 'skill', skill: c.getSkill() })
      } else if ($isTextNode(c)) t += c.getTextContent()
      else t += c.getTextContent()
    }
    if (t || !blocks.length) blocks.push({ id: crypto.randomUUID(), kind: 'text', text: t })
  }
  return {
    blocks: blocks.length ? blocks : [{ id: crypto.randomUUID(), kind: 'text', text: '' }],
    attachments: a,
  }
}
export const LexicalComposerEditor = React.forwardRef<
  LexicalComposerHandle,
  {
    value: string
    skills: readonly ComposerSkill[]
    attachments: InputDraft['attachments']
    disabled: boolean
    placeholder: string
    onChange: (v: string, s: readonly ComposerSkill[]) => void
    onAttachmentsChange: (a: InputDraft['attachments']) => void
    onSubmit: () => void
    onCommandChange: (m: { query: string; trigger: '/' | '@' } | null) => void
    onPasteError: (m?: string) => void
  }
>(function LexicalComposerEditor(p, ref) {
  const config = {
    namespace: 'CodexComposer',
    editable: !p.disabled,
    nodes: [CodeNode, SkillNode],
    theme: {
      code: 'my-1 block min-h-10 whitespace-pre-wrap rounded-lg border border-app-border bg-app-surface-subtle px-4 py-2 font-mono text-[13px] leading-6',
      paragraph: 'm-0 min-h-6 whitespace-pre-wrap break-words',
    },
    onError: (e: Error) => {
      throw e
    },
    editorState: () => setDraft(parseDraft(p.value, p.skills)),
  }
  return (
    <LexicalComposer initialConfig={config}>
      <Plugins {...p} handle={ref} />
      <div className="relative w-full text-left" dir="ltr">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Message"
              className="max-h-60 min-h-12 w-full overflow-y-auto text-left text-sm leading-6 outline-none"
              dir="ltr"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute top-0 left-0 text-sm leading-6 text-app-text-subtle">
              {p.placeholder}
            </div>
          }
          ErrorBoundary={({ children }) => <>{children}</>}
        />
      </div>
      <HistoryPlugin />
    </LexicalComposer>
  )
})
function Plugins(
  p: React.ComponentProps<typeof LexicalComposerEditor> & {
    handle: React.ForwardedRef<LexicalComposerHandle>
  },
) {
  const [e] = useLexicalComposerContext()
  const lastEditorValue = React.useRef(p.value)
  const lastPropValue = React.useRef(p.value)
  const commandNode = React.useRef<{ key: string; start: number; end: number } | null>(null)
  const latest = React.useRef(p)
  React.useEffect(() => {
    latest.current = p
  }, [p])
  React.useEffect(() => {
    const previousPropValue = lastPropValue.current
    lastPropValue.current = p.value
    if (p.value === previousPropValue || p.value === lastEditorValue.current) return
    lastEditorValue.current = p.value
    e.update(() => setDraft(parseDraft(p.value, p.skills)), { tag: 'external' })
  }, [e, p.skills, p.value])
  React.useEffect(() => {
    e.setEditable(!p.disabled)
  }, [e, p.disabled])
  React.useImperativeHandle(
    p.handle,
    () => ({
      insertSkill: (skill) => e.dispatchCommand(INSERT_COMPOSER_SKILL_COMMAND, skill),
      removeActiveCommand: () => {
        const target = commandNode.current
        if (!target) return
        e.update(() => {
          const node = $getNodeByKey(target.key)
          if (!$isTextNode(node)) return
          node.select(target.start, target.end)
          const selection = $getSelection()
          if ($isRangeSelection(selection)) selection.removeText()
        })
        commandNode.current = null
      },
      clear: () => e.update(() => setDraft(parseDraft('', latest.current.skills))),
    }),
    [e],
  )
  React.useEffect(
    () =>
      e.registerUpdateListener(({ tags }) => {
        if (tags.has('external')) return
        e.getEditorState().read(() => {
          const d = readDraft(latest.current.attachments)
          lastEditorValue.current = serializeDraft(d)
          latest.current.onChange(lastEditorValue.current, draftSkills(d))
          const s = $getSelection()
          if ($isRangeSelection(s) && s.isCollapsed() && $isTextNode(s.anchor.getNode())) {
            const t = s.anchor.getNode().getTextContent(),
              o = s.anchor.offset
            let i = o
            while (i > 0 && !/\s/.test(t[i - 1])) i--
            const tr = t[i]
            const active = o > i && (tr === '/' || tr === '@')
            commandNode.current = active ? { key: s.anchor.key, start: i, end: o } : null
            latest.current.onCommandChange(
              active ? { query: t.slice(i + 1, o), trigger: tr } : null,
            )
          } else {
            commandNode.current = null
            latest.current.onCommandChange(null)
          }
        })
      }),
    [e],
  )
  React.useEffect(
    () =>
      e.registerCommand(
        INSERT_COMPOSER_SKILL_COMMAND,
        (skill: ComposerSkill) => {
          const target = commandNode.current
          if (!target) return false
          e.update(() => {
            const node = $getNodeByKey(target.key)
            if (!$isTextNode(node)) return
            node.select(target.start, target.end)
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            selection.insertNodes([$createSkillNode(skill), $createTextNode(' ')])
          })
          commandNode.current = null
          latest.current.onCommandChange(null)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [e],
  )
  React.useEffect(
    () =>
      e.registerNodeTransform(TextNode, (node) => {
        if ($isSkillNode(node) || node.getTextContent() !== '```') return
        const paragraph = node.getParent()
        if (!$isParagraphNode(paragraph) || paragraph.getTextContent() !== '```') return
        const code = $createCodeNode()
        const trailingParagraph = $createParagraphNode()
        paragraph.replace(code)
        code.insertAfter(trailingParagraph)
        code.selectStart()
      }),
    [e],
  )
  React.useEffect(
    () =>
      e.registerCommand(
        KEY_ENTER_COMMAND,
        (x) => {
          if (x && !x.shiftKey && !x.isComposing) {
            const selection = $getSelection()
            if ($isRangeSelection(selection) && $isCodeNode(selection.anchor.getNode().getParent()))
              return false
            x.preventDefault()
            latest.current.onSubmit()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [e],
  )
  React.useEffect(
    () =>
      e.registerCommand(
        COPY_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false
          const node = selection.anchor.getNode()
          const code = $isCodeNode(node.getParent())
            ? node.getParent()
            : $isCodeNode(node)
              ? node
              : null
          if (code && selection.isCollapsed()) return false
          if (code) {
            event.preventDefault()
            event.clipboardData?.setData('text/plain', fenceCode(code.getTextContent()))
            return true
          }
          if ($isSkillNode(node)) {
            event.preventDefault()
            const skill = node.getSkill()
            event.clipboardData?.setData('text/plain', skillMarkdownLink(skill.name, skill.scope))
            return true
          }
          return false
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [e],
  )
  React.useEffect(
    () =>
      e.registerCommand(
        PASTE_COMMAND,
        (x) => {
          if (!(x instanceof ClipboardEvent)) return false
          const t = x.clipboardData?.getData('text/plain') || ''
          if (t.length + latest.current.value.length > MAX_MESSAGE_LENGTH) {
            x.preventDefault()
            latest.current.onPasteError(
              `Can't paste this content. The message would exceed the ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} character limit.`,
            )
            return true
          }
          if (shouldUseCard(t)) {
            x.preventDefault()
            latest.current.onAttachmentsChange([...latest.current.attachments, createAttachment(t)])
            return true
          }
          const detection = detectCodePaste({
            text: t,
            html: x.clipboardData?.getData('text/html') ?? '',
            vscodeEditorData: x.clipboardData?.getData('vscode-editor-data') ?? '',
            vscodeCopyMetadata: x.clipboardData?.getData('application/vnd.code.copymetadata') ?? '',
          })
          if (detection.codeLike && $getRoot().getTextContent().trim() === '') {
            x.preventDefault()
            e.update(() => {
              const code = $createCodeNode()
              code.append($createTextNode(detection.text))
              $getRoot().clear().append(code, $createParagraphNode())
              code.selectEnd()
            })
            return true
          }
          if (parseDraft(t, latest.current.skills).blocks.some((block) => block.kind !== 'text')) {
            x.preventDefault()
            e.update(() => {
              const selection = $getSelection()
              if (!$isRangeSelection(selection)) return
              const parsed = parseDraft(t, latest.current.skills)
              const nodes: LexicalNode[] = parsed.blocks.flatMap((block): LexicalNode[] => {
                if (block.kind === 'code')
                  return [$createCodeNode().append($createTextNode(block.text))]
                if (block.kind === 'skill') return [$createSkillNode(block.skill)]
                return [$createTextNode(block.text)]
              })
              selection.insertNodes(nodes)
            })
            return true
          }
          return false
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [e],
  )
  return null
}
