import { describe, expect, it } from 'vitest'

import {
  GUEST_COMPOSER_CAPABILITIES,
  OWNER_NEW_CHAT_COMPOSER_CAPABILITIES,
  OWNER_THREAD_COMPOSER_CAPABILITIES,
} from './composer-capabilities'

describe('composer capability config', () => {
  it('does not let the Guest capability select an Owner-only access mode', () => {
    expect(GUEST_COMPOSER_CAPABILITIES.accessOptions).toEqual(['workspaceWrite'])
    expect(GUEST_COMPOSER_CAPABILITIES.access).toBe('workspaceWrite')
  })

  it('keeps Guest attachments and high reasoning unavailable', () => {
    expect(GUEST_COMPOSER_CAPABILITIES.attachments).toBe(false)
    expect(GUEST_COMPOSER_CAPABILITIES.availableModels).toContain('gpt-5.6-sol')
    expect(GUEST_COMPOSER_CAPABILITIES.disabledModels).toContain('gpt-5.6-sol')
    expect(GUEST_COMPOSER_CAPABILITIES.disabledEfforts).toContain('high')
    expect(GUEST_COMPOSER_CAPABILITIES.disabledEfforts).toContain('xhigh')
    expect(GUEST_COMPOSER_CAPABILITIES.disabledEffortMessage).toBeTruthy()
  })

  it('keeps every configured access and effort value within the shared unions', () => {
    const accessValues = new Set(['full', 'readOnly', 'workspaceWrite'])
    const modelValues = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'])
    const effortValues = ['low', 'medium', 'high', 'xhigh']
    for (const capability of [
      GUEST_COMPOSER_CAPABILITIES,
      OWNER_NEW_CHAT_COMPOSER_CAPABILITIES,
      OWNER_THREAD_COMPOSER_CAPABILITIES,
    ]) {
      expect(capability.accessOptions.every((value) => accessValues.has(value))).toBe(true)
      expect(capability.availableModels.every((value) => modelValues.has(value))).toBe(true)
      expect(capability.disabledModels.every((value) => modelValues.has(value))).toBe(true)
      expect(capability.disabledEfforts.every((value) => effortValues.includes(value))).toBe(true)
      expect(capability.accessOptions).toContain(capability.access)
    }
  })

  it('withholds context usage from the Owner New Chat composer until a Thread exists', () => {
    expect(OWNER_NEW_CHAT_COMPOSER_CAPABILITIES.contextUsage).toBe(false)
    expect(OWNER_THREAD_COMPOSER_CAPABILITIES.contextUsage).toBe(true)
    expect(OWNER_THREAD_COMPOSER_CAPABILITIES.accessOptions).toEqual([
      'full',
      'readOnly',
      'workspaceWrite',
    ])
  })
})
