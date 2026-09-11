import { describe, expect, it } from 'vitest'

import { composerScopeForTarget } from './composer-scope'

describe('composer scope keys', () => {
  it('keeps a Thread scope distinct from the New Chat draft scope for the same project', () => {
    const thread = composerScopeForTarget('user-a', { projectId: null, threadId: 'thread-1' })
    const draft = composerScopeForTarget('user-a', { projectId: null, threadId: null })

    expect(thread).not.toBe(draft)
    expect(thread).toBe('user:user-a\0thread:<root>\0thread-1')
    expect(draft).toBe('user:user-a\0draft:<root>')
  })

  it('separates the same Thread id across projects and users', () => {
    const target = { projectId: 'project-a', threadId: 'thread-1' }
    expect(composerScopeForTarget('user-a', target)).not.toBe(
      composerScopeForTarget('user-a', { ...target, projectId: 'project-b' }),
    )
    expect(composerScopeForTarget('user-a', target)).not.toBe(
      composerScopeForTarget('user-b', target),
    )
  })

  it('namespaces every scope under the owning user prefix', () => {
    for (const target of [
      { projectId: null, threadId: null },
      { projectId: 'project-a', threadId: 'thread-1' },
    ])
      expect(composerScopeForTarget('user-a', target).startsWith('user:user-a\0')).toBe(true)
  })
})
