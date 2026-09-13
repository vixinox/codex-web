import type { ChatPlanPresentation, ChatTokenUsage, ChatUserInputRequest } from './types'

export type ComposerSkill = {
  handle: string
  name: string
  displayName: string
  description: string
  scope: 'user' | 'repo' | 'system' | 'admin'
}

export type SkillPickerViewModel =
  | { status: 'loading'; items: readonly ComposerSkill[] }
  | { status: 'error'; items: readonly ComposerSkill[]; message: string }
  | { status: 'ready'; items: readonly ComposerSkill[] }

export type ChatModel = 'gpt-5.6-sol' | 'gpt-5.6-terra' | 'gpt-5.5'
export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh'
/**
 * The owner workspace is allowed to opt into full access. Other workspace
 * modes can reuse the composer while accurately describing a more limited
 * runtime boundary.
 */
export type ChatAccess = 'full' | 'readOnly' | 'workspaceWrite'
export type CollaborationMode = 'default' | 'plan'

export type DraftEditorModel = {
  draft: string
}

export type ComposerConfig = {
  model: ChatModel
  effort: ChatEffort
  collaborationMode: CollaborationMode
}

export type ComposerRuntime = {
  submitting: boolean
  working: boolean
  error: string | null
  tokenUsage?: ChatTokenUsage
  contextWindow?: number
}

export type ComposerViewModel = DraftEditorModel &
  ComposerConfig &
  ComposerRuntime & {
    skills: SkillPickerViewModel
    selectedSkills: readonly ComposerSkill[]
  }

export type DraftEditorActions = {
  setDraft(value: string, skills?: readonly ComposerSkill[]): void
  submit(text: string, skills?: readonly ComposerSkill[]): Promise<void>
  onCommand?(command: 'compact' | 'plan'): void
}

export type ComposerActions = DraftEditorActions & {
  setModel: (value: ChatModel) => void
  setEffort: (value: ChatEffort) => void
  setCollaborationMode: (value: CollaborationMode) => void
  retrySkills: () => void
  stop?: () => Promise<void>
  submitWithMode?: (text: string, mode: CollaborationMode) => Promise<void>
}

export type ThreadComposerSlotModel =
  | { kind: 'input'; composer: ComposerViewModel; plan?: ChatPlanPresentation }
  | { kind: 'questionnaire'; request: ChatUserInputRequest }
  | { kind: 'final-plan'; plan: ChatPlanPresentation }
  | { kind: 'error'; message: string }
