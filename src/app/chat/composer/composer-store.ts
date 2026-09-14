import { proxy, useSnapshot } from 'valtio'
import type {
  ChatEffort,
  ChatModel,
  CollaborationMode,
  ComposerSkill,
} from '@/app/chat/model/composer-types'

export type ComposerScope = string

export type ComposerPreferences = {
  model: ChatModel
  effort: ChatEffort
  collaborationMode: CollaborationMode
}

export type ComposerDraftState = {
  draft: string
  preferences: ComposerPreferences
  skills: ComposerSkill[]
}

export type ComposerStore = {
  scopes: Record<ComposerScope, ComposerDraftState>
}

export const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  model: 'gpt-5.6-sol',
  effort: 'medium',
  collaborationMode: 'plan',
}

export const composerStore = proxy<ComposerStore>({ scopes: {} })
const activeUserCounts = new Map<string, number>()

export function resetComposerStore(userId?: string) {
  if (!userId) {
    composerStore.scopes = {}
    return
  }
  const prefix = `user:${userId}\0`
  for (const scope of Object.keys(composerStore.scopes)) {
    if (scope.startsWith(prefix)) delete composerStore.scopes[scope]
  }
}

export function retainComposerUser(userId: string) {
  activeUserCounts.set(userId, (activeUserCounts.get(userId) ?? 0) + 1)
}

export function releaseComposerUser(userId: string) {
  const remaining = Math.max(0, (activeUserCounts.get(userId) ?? 0) - 1)
  if (remaining) {
    activeUserCounts.set(userId, remaining)
    return
  }
  activeUserCounts.delete(userId)
  queueMicrotask(() => {
    if (!activeUserCounts.has(userId)) resetComposerStore(userId)
  })
}

export function ensureComposerScope(scope: ComposerScope, initial?: ComposerPreferences) {
  const existing = composerStore.scopes[scope]
  if (existing) return existing
  const state = proxy<ComposerDraftState>({
    draft: '',
    preferences: { ...(initial ?? DEFAULT_COMPOSER_PREFERENCES) },
    skills: [],
  })
  composerStore.scopes[scope] = state
  return state
}

export function useComposerScopeSnapshot(scope: ComposerScope) {
  ensureComposerScope(scope)
  return useSnapshot(composerStore.scopes[scope])
}

export function setComposerDraft(
  scope: ComposerScope,
  draft: string,
  skills?: readonly ComposerSkill[],
) {
  const state = ensureComposerScope(scope)
  state.draft = draft
  if (skills) state.skills = [...skills]
}

export function updateComposerPreferences(
  scope: ComposerScope,
  update: (preferences: ComposerPreferences) => ComposerPreferences,
) {
  const state = ensureComposerScope(scope)
  const next = update({ ...state.preferences })
  state.preferences = next
  return next
}

export function clearComposerDraft(scope: ComposerScope) {
  ensureComposerScope(scope).draft = ''
}

export function toggleComposerSkill(scope: ComposerScope, skill: ComposerSkill) {
  const state = ensureComposerScope(scope)
  state.skills = state.skills.some((selected) => selected.handle === skill.handle)
    ? state.skills.filter((selected) => selected.handle !== skill.handle)
    : [...state.skills, skill]
}

export function removeComposerSkill(scope: ComposerScope, handle: string) {
  const state = ensureComposerScope(scope)
  state.skills = state.skills.filter((skill) => skill.handle !== handle)
}

export function clearComposerSkills(scope: ComposerScope) {
  ensureComposerScope(scope).skills = []
}
