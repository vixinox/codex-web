import { ownerThreadClient } from '@/lib/bridge/thread-adapters'
import { fetchSkills } from '@/lib/bridge/http/skills'
import { fetchContextWindow } from '@/lib/bridge/http/configuration'
import { subscribeToEvents } from '@/lib/bridge/events/event-source'
import { OWNER_THREAD_COMPOSER_CAPABILITIES } from '@/app/chat/composer/composer-capabilities'
import {
  readNewChatSelection,
  readThreadSelection,
  writeNewChatSelection,
  writeThreadSelection,
} from './chat-selection-storage'
import type { ComposerRuntimeAdapter } from './composer-adapter'

/** Owner runtime: `/api/*` transport, Owner capabilities, durable selection. */
export const ownerComposerAdapter: ComposerRuntimeAdapter = {
  capabilities: OWNER_THREAD_COMPOSER_CAPABILITIES,
  threads: ownerThreadClient,
  acceptedTurnIdIsNative: true,
  selection: {
    read: (userId, target) =>
      target.threadId
        ? readThreadSelection(userId, target.threadId, target.projectId)
        : readNewChatSelection(userId),
    write: (userId, target, preferences) => {
      if (target.threadId)
        writeThreadSelection(userId, target.threadId, preferences, target.projectId)
      else writeNewChatSelection(userId, preferences)
    },
  },
  listSkills: (projectId, signal) => fetchSkills(projectId, signal),
  readContextWindow: async (signal) => (await fetchContextWindow(signal)).modelContextWindow,
  subscribeToSkillChanges: (onChange) =>
    subscribeToEvents({
      url: '/api/events?scope=workspace',
      events: ['skills/changed'],
      onEvent: () => onChange(),
    }),
}
