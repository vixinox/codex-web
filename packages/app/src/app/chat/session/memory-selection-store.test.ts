import { describe, expect, it } from 'vitest'

import { DEFAULT_COMPOSER_PREFERENCES } from '@/app/chat/composer/state/composer-store'
import { createMemorySelectionStore } from './state/memory-selection-store'

describe('memory Composer selection store', () => {
  it('keeps New Chat and every Thread target independent', () => {
    const store = createMemorySelectionStore()
    const threadA = { projectId: null, threadId: 'thread-a' }
    const threadB = { projectId: null, threadId: 'thread-b' }
    const newChat = { projectId: null, threadId: null }

    store.write('user-1', threadA, {
      model: 'gpt-5.6-terra',
      effort: 'low',
      collaborationMode: 'plan',
    })

    expect(store.read('user-1', threadA)).toMatchObject({ model: 'gpt-5.6-terra' })
    expect(store.read('user-1', threadB)).toEqual(DEFAULT_COMPOSER_PREFERENCES)
    expect(store.read('user-1', newChat)).toEqual(DEFAULT_COMPOSER_PREFERENCES)
  })

  it('does not carry selections between user identities', () => {
    const store = createMemorySelectionStore()
    const target = { projectId: null, threadId: null }
    store.write('user-old', target, {
      model: 'gpt-5.5',
      effort: 'medium',
      collaborationMode: 'default',
    })

    expect(store.read('user-new', target)).toEqual(DEFAULT_COMPOSER_PREFERENCES)
  })
})
