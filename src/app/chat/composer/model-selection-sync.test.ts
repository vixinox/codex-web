import { describe, expect, it } from 'vitest'

import {
  GUEST_COMPOSER_CAPABILITIES,
  OWNER_THREAD_COMPOSER_CAPABILITIES,
} from './composer-capabilities'
import { syncComposerPreferences } from './model-selection-sync'

const current = {
  model: 'gpt-5.6-sol' as const,
  effort: 'medium' as const,
  collaborationMode: 'plan' as const,
}

describe('Thread Composer selection sync', () => {
  it('overrides only settings supplied by the Thread truth', () => {
    expect(
      syncComposerPreferences(
        current,
        { model: 'gpt-5.6-terra' },
        OWNER_THREAD_COMPOSER_CAPABILITIES,
      ),
    ).toEqual({ ...current, model: 'gpt-5.6-terra' })
    expect(
      syncComposerPreferences(
        current,
        { reasoningEffort: 'high' },
        OWNER_THREAD_COMPOSER_CAPABILITIES,
      ),
    ).toEqual({ ...current, effort: 'high' })
  })

  it('keeps local values when the Thread fields are missing or unavailable', () => {
    expect(syncComposerPreferences(current, undefined, OWNER_THREAD_COMPOSER_CAPABILITIES)).toEqual(
      current,
    )
    expect(
      syncComposerPreferences(current, { reasoningEffort: 'high' }, GUEST_COMPOSER_CAPABILITIES),
    ).toEqual(current)
  })

  it('applies only server fields that changed since the previous truth', () => {
    expect(
      syncComposerPreferences(
        { ...current, model: 'gpt-5.5' },
        { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
        OWNER_THREAD_COMPOSER_CAPABILITIES,
        { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
      ),
    ).toEqual({ ...current, model: 'gpt-5.5', effort: 'high' })
  })
})
