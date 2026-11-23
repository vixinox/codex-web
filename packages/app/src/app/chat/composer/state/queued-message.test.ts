import { describe, expect, it } from 'vitest'
import { claimQueuedMessage, queueTransition, type QueueContext } from './queued-message'
import type { QueuedMessage } from './composer-store'
const queue = (): QueuedMessage => ({
  id: 'q',
  turnId: 't',
  draft: 'next',
  text: 'next',
  skills: [],
  preferences: { model: 'model', effort: 'medium', collaborationMode: 'default' },
  status: 'queued',
})
const context = (status: string): QueueContext => ({
  healthy: true,
  blocked: false,
  nonSteerable: false,
  turns: [{ id: 't', status }],
})
describe('queued message dispatch boundaries', () => {
  it('dispatches only after the bound turn completes with a healthy idle thread', () => {
    expect(queueTransition(queue(), context('completed'), false)).toBe('send')
    for (const status of ['inProgress', 'unknown'])
      expect(queueTransition(queue(), context(status), false)).toBe('wait')
    expect(queueTransition(queue(), { ...context('completed'), healthy: false }, false)).toBe(
      'wait',
    )
    expect(queueTransition(queue(), { ...context('completed'), blocked: true }, false)).toBe('wait')
    expect(queueTransition(queue(), context('completed'), true)).toBe('wait')
    expect(
      queueTransition(
        queue(),
        { ...context('completed'), turns: [{ id: 'another', status: 'completed' }] },
        false,
      ),
    ).toBe('wait')
  })
  it('pauses on failure or interruption and never resumes paused or submitting items', () => {
    for (const status of ['failed', 'interrupted'])
      expect(queueTransition(queue(), context(status), false)).toBe('pause')
    for (const status of ['paused', 'sending'] as const)
      expect(queueTransition({ ...queue(), status }, context('completed'), false)).toBe('wait')
  })
  it('allows only one caller to claim the same item', () => {
    const item = queue()
    expect(claimQueuedMessage(item)).toBe(true)
    expect(claimQueuedMessage(item)).toBe(false)
    expect(queueTransition(item, context('completed'), false)).toBe('wait')
  })
})
