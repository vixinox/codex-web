import type { ComposerCapabilities } from './composer-capabilities'
import type { ComposerPreferences } from './composer-store'
import type { ChatEffort, ChatModel } from '@/app/chat/model/composer-types'

export type ThreadComposerSelection = {
  model?: ChatModel
  reasoningEffort?: ChatEffort
}

export function syncComposerPreferences(
  current: ComposerPreferences,
  thread: ThreadComposerSelection | undefined,
  capabilities: ComposerCapabilities,
  previous?: ThreadComposerSelection,
): ComposerPreferences {
  const model =
    thread?.model &&
    thread.model !== previous?.model &&
    capabilities.availableModels.includes(thread.model) &&
    !capabilities.disabledModels.includes(thread.model)
      ? thread.model
      : current.model
  const effort =
    thread?.reasoningEffort &&
    thread.reasoningEffort !== previous?.reasoningEffort &&
    !capabilities.disabledEfforts.includes(thread.reasoningEffort)
      ? thread.reasoningEffort
      : current.effort
  return { ...current, model, effort }
}
