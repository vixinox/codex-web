import { ownerThreadDomainAdapter } from '@/app/chat/domain/owner-thread-adapter'
import { fetchSkills } from '@/lib/bridge/http/skills'
import { fetchContextWindow } from '@/lib/bridge/http/configuration'
import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
import { EMPTY_OWNER_COMPOSER_CAPABILITIES } from '@/app/chat/composer/model/composer-capabilities'
import {
  readNewChatSelection,
  readThreadSelection,
  writeNewChatSelection,
  writeThreadSelection,
} from '../state/chat-selection-storage'
import type { ComposerRuntimeAdapter } from './composer-adapter'

/** Owner runtime: `/api/*` transport, Owner capabilities, durable selection. */
export const ownerComposerAdapter: ComposerRuntimeAdapter = {
  capabilities: EMPTY_OWNER_COMPOSER_CAPABILITIES,
  threads: ownerThreadDomainAdapter,
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
    (() => {
      const stream = getOwnerBridge().openStream(
        { method: 'events.subscribe', params: { scope: 'workspace', events: ['skills/changed'] } },
        { onEvent: onChange },
      )
      return () => stream.cancel()
    })(),
}
