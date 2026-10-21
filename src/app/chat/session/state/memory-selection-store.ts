import type { ComposerPreferences } from '@/app/chat/composer/state/composer-store'
import { DEFAULT_COMPOSER_PREFERENCES } from '@/app/chat/composer/state/composer-store'
import type { ComposerSelectionStore, ComposerSelectionTarget } from '../adapters/composer-adapter'

/**
 * In-memory selection for runtimes without durable per-Thread storage. Scopes
 * are keyed by user and Thread so New Chat cannot inherit a Thread selection.
 */
export function createMemorySelectionStore(
  initial: ComposerPreferences = DEFAULT_COMPOSER_PREFERENCES,
): ComposerSelectionStore {
  const perUser = new Map<string, Map<string, ComposerPreferences>>()
  const keyFor = (target: ComposerSelectionTarget) =>
    target.threadId ? `${target.projectId ?? '<root>'}\0${target.threadId}` : '<new-chat>'

  return {
    read: (userId, target) => {
      const preferences = perUser.get(userId)?.get(keyFor(target))
      return { ...(preferences ?? initial) }
    },
    write: (userId, target, preferences) => {
      const byTarget = perUser.get(userId) ?? new Map<string, ComposerPreferences>()
      byTarget.set(keyFor(target), { ...preferences })
      perUser.set(userId, byTarget)
    },
  }
}
