import type { ChatAccess, ChatEffort, ChatModel } from '@/app/chat/model/composer-types'

/**
 * Runtime differences a Composer surface hands to the shared renderer.
 * Owner and Guest keep separate values; the renderer itself stays
 * runtime-agnostic and never branches on which profile it renders.
 */
export type ComposerCapabilities = {
  accessOptions: readonly ChatAccess[]
  attachments: boolean
  contextUsage: boolean
  availableModels: readonly ChatModel[]
  disabledModels: readonly ChatModel[]
  disabledEfforts: readonly ChatEffort[]
  access: ChatAccess
  disabledModelMessage?: string
  disabledEffortMessage?: string
}

export const ALL_ACCESS_OPTIONS: readonly ChatAccess[] = ['full', 'readOnly', 'workspaceWrite']

export const ALL_CHAT_MODELS: readonly ChatModel[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5']

/** Owner Thread Composer: full access choice and general attachments. */
export const OWNER_THREAD_COMPOSER_CAPABILITIES: ComposerCapabilities = {
  accessOptions: ALL_ACCESS_OPTIONS,
  attachments: true,
  contextUsage: true,
  availableModels: ALL_CHAT_MODELS,
  disabledModels: [],
  disabledEfforts: [],
  access: 'full',
}

/** Owner New Chat Composer: no attachments or usage until a Thread exists. */
export const OWNER_NEW_CHAT_COMPOSER_CAPABILITIES: ComposerCapabilities = {
  ...OWNER_THREAD_COMPOSER_CAPABILITIES,
  attachments: false,
  contextUsage: false,
}

/**
 * Guest Composer: isolated workspace write access only, no attachments,
 * and low/medium reasoning effort per the Guest capability boundary.
 */
export const GUEST_COMPOSER_CAPABILITIES: ComposerCapabilities = {
  accessOptions: ['workspaceWrite'],
  attachments: false,
  contextUsage: true,
  availableModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'],
  disabledModels: ['gpt-5.6-sol'],
  disabledEfforts: ['high', 'xhigh'],
  access: 'workspaceWrite',
  disabledModelMessage: '5.6 Sol is unavailable in Guest Workspace.',
  disabledEffortMessage: 'High and Extra High reasoning are unavailable in Guest Workspace.',
}
