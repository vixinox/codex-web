import { ownerThreadDomainAdapter } from '@/app/chat/domain/owner-thread-adapter'
import { readOwnerConversation } from '@/app/chat/domain/owner-conversation-client'
import { ownerWorkspace } from '@/app/workspace/domain/owner-workspace'
import { ownerSettings } from '@/app/settings/domain/owner-settings'
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
  async waitForThread(projectId, threadId, signal) {
    await readOwnerConversation(projectId, threadId, signal)
  },
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
  listSkills: (projectId, signal) => ownerWorkspace.skills(projectId, signal),
  readContextWindow: async (signal) =>
    (await ownerSettings.configuration.read(signal)).modelContextWindow,
  subscribeToSkillChanges: (onChange) =>
    (() => {
      const stream = getOwnerBridge().openStream(
        { method: 'events.subscribe', params: { scope: 'workspace', events: ['skills/changed'] } },
        { onEvent: onChange },
      )
      return () => stream.cancel()
    })(),
}
