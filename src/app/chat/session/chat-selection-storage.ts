import type { ComposerPreferences } from '@/app/chat/composer/composer-store'
import type { ChatEffort, ChatModel } from '@/app/chat/model/composer-types'

export type ChatSelection = ComposerPreferences

const DEFAULT_SELECTION: ChatSelection = {
  model: 'gpt-5.6-sol',
  effort: 'low',
  collaborationMode: 'default',
}
const MODELS = new Set<ChatModel>(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'])
const EFFORTS = new Set<ChatEffort>(['low', 'medium', 'high', 'xhigh'])

function selectionKey(
  userId: string,
  scope: 'new' | `thread:${string}`,
  projectId?: string | null,
) {
  const projectScope = projectId === undefined ? '' : `:${projectId ?? '<root>'}`
  return `codex-web:chat-selection:v2:${userId}:${scope}${projectScope}`
}

function readSelection(key: string): ChatSelection {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { ...DEFAULT_SELECTION }
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!MODELS.has(value.model as ChatModel) || !EFFORTS.has(value.effort as ChatEffort))
      return { ...DEFAULT_SELECTION }
    return {
      model: value.model as ChatModel,
      effort: value.effort as ChatEffort,
      collaborationMode: value.collaborationMode === 'plan' ? 'plan' : 'default',
    }
  } catch {
    return { ...DEFAULT_SELECTION }
  }
}

function writeSelection(key: string, selection: ChatSelection) {
  try {
    localStorage.setItem(key, JSON.stringify(selection))
  } catch {
    // Storage can be unavailable; sending a Turn must still work.
  }
}

export function readNewChatSelection(userId: string) {
  return readSelection(selectionKey(userId, 'new'))
}

export function writeNewChatSelection(userId: string, selection: ChatSelection) {
  writeSelection(selectionKey(userId, 'new'), selection)
}

export function readThreadSelection(userId: string, threadId: string, projectId?: string | null) {
  return readSelection(selectionKey(userId, `thread:${threadId}`, projectId))
}

export function writeThreadSelection(
  userId: string,
  threadId: string,
  selection: ChatSelection,
  projectId?: string | null,
) {
  writeSelection(selectionKey(userId, `thread:${threadId}`, projectId), selection)
}
