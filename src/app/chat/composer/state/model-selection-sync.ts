import type { ComposerCapabilities } from '../model/composer-capabilities'
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
  if (capabilities.availableModels.length === 0 || capabilities.availableEfforts.length === 0)
    return current
  const defaultModel = capabilities.availableModels[0] ?? ''
  const model =
    thread?.model &&
    thread.model !== previous?.model &&
    capabilities.availableModels.includes(thread.model) &&
    thread.model
      ? thread.model
      : capabilities.availableModels.includes(current.model)
        ? current.model
        : defaultModel
  const defaultEffort =
    capabilities.modelDefaultEfforts[model] &&
    capabilities.availableEfforts.includes(capabilities.modelDefaultEfforts[model])
      ? capabilities.modelDefaultEfforts[model]
      : (capabilities.availableEfforts[0] ?? '')
  const effort =
    thread?.reasoningEffort &&
    thread.reasoningEffort !== previous?.reasoningEffort &&
    capabilities.availableEfforts.includes(thread.reasoningEffort) &&
    thread.reasoningEffort
      ? thread.reasoningEffort
      : capabilities.availableEfforts.includes(current.effort)
        ? current.effort
        : defaultEffort
  return { ...current, model, effort }
}
