import { describe, expect, it } from 'vitest'
import {
  ensureComposerScope,
  removeComposerSkill,
  releaseComposerUser,
  retainComposerUser,
  resetComposerStore,
  setComposerDraft,
  toggleComposerSkill,
  updateComposerPreferences,
} from './composer-store'

describe('composer store', () => {
  it('isolates scopes by user and can reset one user without affecting another', () => {
    const first = 'user:user-a\0thread:project\0thread-1'
    const second = 'user:user-b\0thread:project\0thread-1'
    resetComposerStore()
    setComposerDraft(first, 'private draft')
    setComposerDraft(second, 'other draft')
    resetComposerStore('user-a')
    expect(ensureComposerScope(first).draft).toBe('')
    expect(ensureComposerScope(second).draft).toBe('other draft')
    resetComposerStore()
  })

  it('clears a released user scope after the current component lifecycle', async () => {
    const scope = 'user:user-release\0thread:project\0thread-1'
    resetComposerStore()
    retainComposerUser('user-release')
    setComposerDraft(scope, 'draft')
    releaseComposerUser('user-release')
    await Promise.resolve()
    expect(ensureComposerScope(scope).draft).toBe('')
    resetComposerStore()
  })

  it('isolates draft and preferences by opaque scope', () => {
    const first = `test:first:${Date.now()}`
    const second = `${first}:second`
    ensureComposerScope(first)
    ensureComposerScope(second)

    setComposerDraft(first, 'first draft')
    updateComposerPreferences(first, (current) => ({ ...current, effort: 'high' }))

    expect(ensureComposerScope(first).draft).toBe('first draft')
    expect(ensureComposerScope(first).preferences.effort).toBe('high')
    expect(ensureComposerScope(second).draft).toBe('')
    expect(ensureComposerScope(second).preferences.effort).toBe('medium')
  })

  it('keeps selected skills isolated by composer scope', () => {
    const first = 'skills-first'
    const second = 'skills-second'
    const skill = {
      handle: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'pdf',
      displayName: 'PDF',
      description: 'Create a PDF',
      scope: 'system' as const,
    }

    toggleComposerSkill(first, skill)
    expect(ensureComposerScope(first).skills).toEqual([skill])
    expect(ensureComposerScope(second).skills).toEqual([])

    removeComposerSkill(first, skill.handle)
    expect(ensureComposerScope(first).skills).toEqual([])
  })
})
