import type { ComposerPreferences } from '@/app/chat/composer/composer-store'
import { DEFAULT_COMPOSER_PREFERENCES } from '@/app/chat/composer/composer-store'
import type { ComposerSelectionStore, ComposerSelectionTarget } from './composer-adapter'

/**
 * In-memory selection for runtimes with no durable per-Thread storage, such as
 * a Guest lease. Scopes are keyed like the durable store, so a new lease (new
 * `userId`) starts from defaults and New Chat cannot inherit a Thread truth.
 */
export function createMemorySelectionStore(): ComposerSelectionStore {
  const perUser = new Map<string, Map<string, ComposerPreferences>>()
  const keyFor = (target: ComposerSelectionTarget) =>
    target.threadId ? `${target.projectId ?? '<root>'}\0${target.threadId}` : '<new-chat>'

  return {
    read: (userId, target) => {
      const preferences = perUser.get(userId)?.get(keyFor(target))
      return { ...(preferences ?? DEFAULT_COMPOSER_PREFERENCES) }
    },
    write: (userId, target, preferences) => {
      const byTarget = perUser.get(userId) ?? new Map<string, ComposerPreferences>()
      byTarget.set(keyFor(target), { ...preferences })
      perUser.set(userId, byTarget)
    },
  }
}
