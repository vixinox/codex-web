import type { ComposerScope } from './composer-store'

export type ComposerScopeTarget = {
  projectId: string | null
  threadId: string | null
}

/**
 * Composer state is scoped per user, then per Thread or per New Chat draft.
 * The `user:<id>\0` prefix is what lets a single user's scopes be reset
 * without touching another user's drafts.
 */
export function composerScopeForTarget(userId: string, target: ComposerScopeTarget): ComposerScope {
  const userPrefix = `user:${userId}\0`
  return target.threadId
    ? `${userPrefix}thread:${target.projectId ?? '<root>'}\0${target.threadId}`
    : `${userPrefix}draft:${target.projectId ?? '<root>'}`
}
