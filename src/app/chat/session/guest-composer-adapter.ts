import { guestThreadClient } from '@/lib/bridge/thread-adapters'
import { fetchGuestSkills, readGuestSession } from '@/lib/bridge/http/guest'
import { GUEST_COMPOSER_CAPABILITIES } from '@/app/chat/composer/composer-capabilities'
import { createMemorySelectionStore } from './memory-selection-store'
import type { ComposerPreferences } from '@/app/chat/composer/composer-store'
import type { ComposerRuntimeAdapter } from './composer-adapter'

/**
 * Guest runtime: `/guest-api/*` transport and Guest capabilities. Selection and
 * context window stay in memory for the lease; no Owner configuration endpoint
 * is ever consulted.
 */
export const guestComposerAdapter: ComposerRuntimeAdapter = {
  capabilities: GUEST_COMPOSER_CAPABILITIES,
  threads: guestThreadClient,
  acceptedTurnIdIsNative: false,
  selection: createMemorySelectionStore({
    model: 'gpt-5.6-terra',
    effort: 'medium',
    collaborationMode: 'plan',
  } satisfies ComposerPreferences),
  listSkills: async () => fetchGuestSkills(),
  readContextWindow: async (signal) => {
    const session = await readGuestSession(signal)
    return session?.runtime.modelContextWindow
  },
  messages: {
    skillsError: 'Guest skills are unavailable',
    submitError: 'Guest turn could not start',
    compactError: 'Guest conversation could not compact',
  },
}
