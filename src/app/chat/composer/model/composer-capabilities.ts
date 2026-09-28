import type { ChatAccess, ChatEffort, ChatModel } from '@/app/chat/model/composer-types'

/**
 * Runtime differences a Composer surface hands to the shared renderer.
 * Owner and Guest keep separate values; the renderer itself stays
 * runtime-agnostic and never branches on which profile it renders.
 */
export type ComposerCapabilities = {
  attachments: boolean
  contextUsage: boolean
  availableModels: readonly ChatModel[]
  modelDisplayNames: Readonly<Record<string, string>>
  modelDefaultEfforts: Readonly<Record<string, string>>
  availableEfforts: readonly ChatEffort[]
  access: ChatAccess
}

export type RuntimeCapabilityModel = {
  id: string
  displayName: string
  defaultReasoningEffort?: string
  reasoningEfforts: readonly (string | { id: string })[]
  inputModalities?: readonly string[]
}

export function composerCapabilitiesFromModels(
  models: readonly RuntimeCapabilityModel[],
  access: ChatAccess,
  base: Pick<ComposerCapabilities, 'attachments' | 'contextUsage'>,
): ComposerCapabilities {
  return {
    ...base,
    availableModels: models.map((model) => model.id),
    modelDisplayNames: Object.fromEntries(
      models.map((model) => [model.id, model.displayName || model.id]),
    ),
    modelDefaultEfforts: Object.fromEntries(
      models.flatMap((model) =>
        model.defaultReasoningEffort ? [[model.id, model.defaultReasoningEffort]] : [],
      ),
    ),
    availableEfforts: [
      ...new Set(
        models.flatMap((model) =>
          model.reasoningEfforts.map((effort) => (typeof effort === 'string' ? effort : effort.id)),
        ),
      ),
    ],
    access,
  }
}

const emptyComposerCapabilities = (access: ChatAccess): ComposerCapabilities => ({
  attachments: access === 'full',
  contextUsage: true,
  availableModels: [],
  modelDisplayNames: {},
  modelDefaultEfforts: {},
  availableEfforts: [],
  access,
})

export const EMPTY_OWNER_COMPOSER_CAPABILITIES = emptyComposerCapabilities('full')
export const EMPTY_GUEST_COMPOSER_CAPABILITIES = emptyComposerCapabilities('workspaceWrite')

export function defaultComposerPreferences(
  capabilities: ComposerCapabilities,
  collaborationMode: 'default' | 'plan' = 'default',
) {
  const model = capabilities.availableModels[0] ?? ''
  const preferredEffort = model ? capabilities.modelDefaultEfforts[model] : undefined
  return {
    model,
    effort:
      preferredEffort && capabilities.availableEfforts.includes(preferredEffort)
        ? preferredEffort
        : (capabilities.availableEfforts[0] ?? ''),
    collaborationMode,
  }
}
