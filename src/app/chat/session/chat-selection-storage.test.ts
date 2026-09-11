import { beforeEach, describe, expect, it } from 'vitest'

import {
  readNewChatSelection,
  readThreadSelection,
  writeNewChatSelection,
  writeThreadSelection,
} from './chat-selection-storage'

describe('chat model selection storage', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the latest New Chat selection separate for each user', () => {
    writeNewChatSelection('user-a', { model: 'gpt-5.6-terra', effort: 'high' })

    expect(readNewChatSelection('user-a')).toMatchObject({ model: 'gpt-5.6-terra', effort: 'high' })
    expect(readNewChatSelection('user-b')).toMatchObject({ model: 'gpt-5.6-sol', effort: 'low' })
  })

  it('keeps the last submitted selection separate for each Thread', () => {
    writeThreadSelection('user-a', 'thread-1', { model: 'gpt-5.5', effort: 'xhigh' })

    expect(readThreadSelection('user-a', 'thread-1')).toMatchObject({
      model: 'gpt-5.5',
      effort: 'xhigh',
    })
    expect(readThreadSelection('user-a', 'thread-2')).toMatchObject({
      model: 'gpt-5.6-sol',
      effort: 'low',
    })
  })

  it('falls back safely when stored values are invalid', () => {
    localStorage.setItem('codex-web:chat-selection:v1:user-a:new', '{"model":"private"}')

    expect(readNewChatSelection('user-a')).toMatchObject({ model: 'gpt-5.6-sol', effort: 'low' })
  })

  it('persists Plan mode per Thread and defaults older selections', () => {
    writeThreadSelection('user-a', 'thread-plan', {
      model: 'gpt-5.6-sol',
      effort: 'high',
      collaborationMode: 'plan',
    })

    expect(readThreadSelection('user-a', 'thread-plan').collaborationMode).toBe('plan')
    expect(readThreadSelection('user-a', 'thread-old').collaborationMode).toBe('default')
  })

  it('isolates the same Thread id across projects', () => {
    writeThreadSelection(
      'user-a',
      'thread-1',
      { model: 'gpt-5.6-terra', effort: 'high' },
      'project-a',
    )

    expect(readThreadSelection('user-a', 'thread-1', 'project-a')).toMatchObject({
      model: 'gpt-5.6-terra',
      effort: 'high',
    })
    expect(readThreadSelection('user-a', 'thread-1', 'project-b')).toMatchObject({
      model: 'gpt-5.6-sol',
      effort: 'low',
    })
  })
})
