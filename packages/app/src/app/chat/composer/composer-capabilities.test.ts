import { describe, expect, it } from 'vitest'

import {
  EMPTY_OWNER_COMPOSER_CAPABILITIES,
  composerCapabilitiesFromModels,
} from './model/composer-capabilities'

const owner = composerCapabilitiesFromModels(
  [{ id: 'gpt-7-new', displayName: '7 New', reasoningEfforts: ['low', 'high'] }],
  'full',
  { attachments: true, contextUsage: true },
)
describe('composer capability config', () => {
  it('keeps every configured access and effort value within the shared unions', () => {
    const accessValues = new Set(['full', 'readOnly', 'workspaceWrite'])
    for (const capability of [EMPTY_OWNER_COMPOSER_CAPABILITIES, owner]) {
      expect(Object.keys(capability.modelDisplayNames).length).toBe(
        capability.availableModels.length,
      )
      expect(accessValues.has(capability.access)).toBe(true)
    }
  })

  it('projects runtime model labels, defaults, and arbitrary efforts', () => {
    const capability = composerCapabilitiesFromModels(
      [
        {
          id: 'gpt-7-new',
          displayName: '7 New',
          defaultReasoningEffort: 'deep',
          reasoningEfforts: [{ id: 'deep' }, { id: 'low' }],
        },
      ],
      'full',
      { attachments: true, contextUsage: true },
    )
    expect(capability.availableModels).toEqual(['gpt-7-new'])
    expect(capability.availableEfforts).toEqual(['deep', 'low'])
    expect(capability.modelDisplayNames).toEqual({ 'gpt-7-new': '7 New' })
    expect(capability.modelDefaultEfforts).toEqual({ 'gpt-7-new': 'deep' })
  })

  it('withholds context usage from the Owner New Chat composer until a Thread exists', () => {
    expect(EMPTY_OWNER_COMPOSER_CAPABILITIES.contextUsage).toBe(true)
    expect(owner.contextUsage).toBe(true)
  })
})
