import { cn } from '@/lib/utils'
import { CommandPanel } from './command-panel'
import { ComposerControls } from './composer-controls'
import { DraftAttachments } from './draft-attachments'
import { LexicalComposerEditor, type LexicalComposerHandle } from './lexical-composer'
import { draftSkills, parseDraft, serializeDraft, serializeDraftSubmission } from './draft-model'
import type { ComposerCapabilities } from './composer-capabilities'
import type { ComposerActions, ComposerViewModel } from '@/app/chat/model/composer-types'
import * as React from 'react'
import type { ReactNode } from 'react'
export type ComposerInputProps = {
  viewModel: ComposerViewModel
  actions: ComposerActions
  disabled?: boolean
  className?: string
  placeholder?: string
  capabilities: ComposerCapabilities
  leadingContent?: ReactNode
}
export function ComposerInput({
  viewModel,
  actions,
  disabled = false,
  className,
  placeholder = 'Ask Codex anything',
  capabilities,
  leadingContent,
}: ComposerInputProps) {
  const skills = React.useMemo(
    () => [
      ...viewModel.selectedSkills,
      ...viewModel.skills.items.filter(
        (s) => !viewModel.selectedSkills.some((x) => x.handle === s.handle),
      ),
    ],
    [viewModel.selectedSkills, viewModel.skills.items],
  )
  const [draft, setDraft] = React.useState(() => parseDraft(viewModel.draft, skills))
  const [command, setCommand] = React.useState<{ query: string; trigger: '/' | '@' } | null>(null)
  const [pasteError, setPasteError] = React.useState<string>()
  const editorRef = React.useRef<LexicalComposerHandle>(null)
  const composerRef = React.useRef<HTMLDivElement>(null)
  const openCommandPanel = React.useCallback(
    (next: { query: string; trigger: '/' | '@' } | null) => {
      setCommand(next)
    },
    [],
  )
  React.useEffect(() => {
    if (command === null) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        setCommand(null)
        return
      }
      if (target.closest('[contenteditable="true"]') || target.closest('[data-command-panel]'))
        return
      setCommand(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [command])
  React.useEffect(() => {
    setDraft(parseDraft(viewModel.draft, skills))
  }, [skills, viewModel.draft])
  const submit = () => {
    const text = serializeDraftSubmission(draft).trim()
    if (text && !disabled && !viewModel.submitting)
      void actions.submit(text, draftSkills(draft), draft.attachments)
  }
  return (
    <div
      ref={composerRef}
      onBlurCapture={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setCommand(null)
      }}
      className="relative mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-2"
    >
      {command === null && leadingContent ? (
        <div className="absolute inset-x-4 bottom-full z-10 flex justify-center">
          {leadingContent}
        </div>
      ) : null}
      {command !== null ? (
        <div className="absolute inset-x-4 bottom-full z-10">
          <CommandPanel
            query={command.query}
            trigger={command.trigger}
            disabled={disabled}
            onCompact={() => {
              editorRef.current?.clear()
              setCommand(null)
              actions.setDraft('', [])
              actions.onCommand?.('compact')
            }}
            onPlan={() => {
              editorRef.current?.removeActiveCommand()
              setCommand(null)
              actions.setCollaborationMode('plan')
            }}
            skills={viewModel.skills}
            selectedSkills={viewModel.selectedSkills}
            onSkillSelect={(skill) => editorRef.current?.insertSkill(skill)}
            onRetrySkills={actions.retrySkills}
          />
        </div>
      ) : null}
      <div
        className={cn(
          'flex w-full flex-col rounded-3xl border border-app-border bg-app-surface-raised px-4 pt-4 pb-2',
          className,
        )}
      >
        <DraftAttachments
          attachments={draft.attachments}
          disabled={disabled}
          submitting={viewModel.submitting}
          onRemove={(id) =>
            setDraft((d) => {
              const next = { ...d, attachments: d.attachments.filter((a) => a.id !== id) }
              actions.setDraft(serializeDraft(next), draftSkills(next))
              return next
            })
          }
        />
        <LexicalComposerEditor
          ref={editorRef}
          value={viewModel.draft}
          skills={skills}
          attachments={draft.attachments}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(v, s) => {
            setDraft(parseDraft(v, skills))
            actions.setDraft(v, s)
          }}
          onAttachmentsChange={(a) =>
            setDraft((d) => {
              const next = { ...d, attachments: a }
              actions.setDraft(serializeDraft(next), draftSkills(next))
              return next
            })
          }
          onSubmit={submit}
          onCommandChange={openCommandPanel}
          onPasteError={setPasteError}
        />
        {pasteError ? (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {pasteError}
          </p>
        ) : null}
        <ComposerControls
          collaborationMode={viewModel.collaborationMode}
          onCollaborationModeChange={actions.setCollaborationMode}
          model={viewModel.model}
          onModelChange={actions.setModel}
          effort={viewModel.effort}
          onEffortChange={actions.setEffort}
          onOpenCommandPanel={() => openCommandPanel({ query: '', trigger: '/' })}
          capabilities={capabilities}
          tokenUsage={viewModel.tokenUsage}
          contextWindow={viewModel.contextWindow}
          disabled={disabled}
          submitting={viewModel.submitting}
          working={viewModel.working}
          onSubmit={submit}
          onStop={actions.stop ? () => void actions.stop?.() : undefined}
          canSubmit={Boolean(serializeDraftSubmission(draft).trim())}
        />
      </div>
    </div>
  )
}
