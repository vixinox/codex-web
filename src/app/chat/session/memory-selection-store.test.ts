import { describe, expect, it } from 'vitest'

import { DEFAULT_COMPOSER_PREFERENCES } from '@/app/chat/composer/composer-store'
import { createMemorySelectionStore } from './memory-selection-store'

describe('memory Composer selection store', () => {
  it('keeps New Chat and every Thread target independent', () => {
    const store = createMemorySelectionStore()
    const threadA = { projectId: null, threadId: 'thread-a' }
    const threadB = { projectId: null, threadId: 'thread-b' }
    const newChat = { projectId: null, threadId: null }

    store.write('guest-1', threadA, {
      model: 'gpt-5.6-terra',
      effort: 'low',
      collaborationMode: 'plan',
    })

    expect(store.read('guest-1', threadA)).toMatchObject({ model: 'gpt-5.6-terra' })
    expect(store.read('guest-1', threadB)).toEqual(DEFAULT_COMPOSER_PREFERENCES)
    expect(store.read('guest-1', newChat)).toEqual(DEFAULT_COMPOSER_PREFERENCES)
  })

  it('does not carry selections into a new Guest lease', () => {
    const store = createMemorySelectionStore()
    const target = { projectId: null, threadId: null }
    store.write('guest-old', target, {
      model: 'gpt-5.5',
      effort: 'medium',
      collaborationMode: 'default',
    })

    expect(store.read('guest-new', target)).toEqual(DEFAULT_COMPOSER_PREFERENCES)
  })
})
