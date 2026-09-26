import { describe, expect, it } from 'vitest'

import {
  EMPTY_GUEST_COMPOSER_CAPABILITIES,
  EMPTY_OWNER_COMPOSER_CAPABILITIES,
  composerCapabilitiesFromModels,
} from './model/composer-capabilities'

const owner = composerCapabilitiesFromModels(
  [{ id: 'gpt-7-new', displayName: '7 New', reasoningEfforts: ['low', 'high'] }],
  'full',
  { attachments: true, contextUsage: true },
)
const guest = EMPTY_GUEST_COMPOSER_CAPABILITIES
describe('composer capability config', () => {
  it('does not let the Guest capability select an Owner-only access mode', () => {
    expect(guest.accessOptions).toEqual(['workspaceWrite'])
    expect(guest.access).toBe('workspaceWrite')
  })

  it('keeps Guest attachments isolated until runtime capabilities load', () => {
    expect(guest.attachments).toBe(false)
    expect(guest.availableModels).toEqual([])
    expect(guest.availableEfforts).toEqual([])
  })

  it('keeps every configured access and effort value within the shared unions', () => {
    const accessValues = new Set(['full', 'readOnly', 'workspaceWrite'])
    for (const capability of [guest, EMPTY_OWNER_COMPOSER_CAPABILITIES, owner]) {
      expect(capability.accessOptions.every((value) => accessValues.has(value))).toBe(true)
      expect(Object.keys(capability.modelDisplayNames).length).toBe(
        capability.availableModels.length,
      )
      expect(capability.accessOptions).toContain(capability.access)
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
    expect(owner.accessOptions).toEqual(['full'])
  })
})
