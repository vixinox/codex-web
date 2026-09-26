import { describe, expect, it } from 'vitest'

import { composerCapabilitiesFromModels } from './model/composer-capabilities'
import { syncComposerPreferences } from './state/model-selection-sync'

const current = {
  model: 'gpt-5.6-sol' as const,
  effort: 'medium' as const,
  collaborationMode: 'plan' as const,
}
const owner = composerCapabilitiesFromModels(
  [
    { id: 'gpt-5.6-sol', displayName: 'Sol', reasoningEfforts: ['low', 'medium', 'high'] },
    { id: 'gpt-5.6-terra', displayName: 'Terra', reasoningEfforts: ['low', 'medium', 'high'] },
    { id: 'gpt-5.5', displayName: '5.5', reasoningEfforts: ['low', 'medium', 'high'] },
  ],
  'full',
  { attachments: true, contextUsage: true },
)
const guest = composerCapabilitiesFromModels(
  [{ id: 'gpt-5.6-terra', displayName: 'Terra', reasoningEfforts: ['low', 'medium'] }],
  'workspaceWrite',
  { attachments: false, contextUsage: true },
)

describe('Thread Composer selection sync', () => {
  it('overrides only settings supplied by the Thread truth', () => {
    expect(syncComposerPreferences(current, { model: 'gpt-5.6-terra' }, owner)).toEqual({
      ...current,
      model: 'gpt-5.6-terra',
    })
    expect(syncComposerPreferences(current, { reasoningEffort: 'high' }, owner)).toEqual({
      ...current,
      effort: 'high',
    })
  })

  it('keeps local values when the Thread fields are missing or unavailable', () => {
    expect(syncComposerPreferences(current, undefined, owner)).toEqual(current)
    expect(syncComposerPreferences(current, { reasoningEffort: 'high' }, guest)).toEqual({
      ...current,
      model: 'gpt-5.6-terra',
    })
    expect(syncComposerPreferences(current, { model: 'gpt-5.6-sol' }, guest)).toEqual({
      ...current,
      model: 'gpt-5.6-terra',
    })
  })

  it('applies only server fields that changed since the previous truth', () => {
    expect(
      syncComposerPreferences(
        { ...current, model: 'gpt-5.5' },
        { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
        owner,
        { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
      ),
    ).toEqual({ ...current, model: 'gpt-5.5', effort: 'high' })
  })
})
