import { describe, expect, it } from 'vitest'
import { derivePlanPhase } from './plan-lifecycle'

const plan = { steps: [], diffStats: { files: 0, additions: 0, deletions: 0 }, final: false }

describe('plan lifecycle', () => {
  it('keeps terminal failures ahead of plan content', () => {
    expect(derivePlanPhase({ status: 'failed', plan: { ...plan, final: true } })).toBe('failed')
    expect(derivePlanPhase({ status: 'interrupted', plan })).toBe('interrupted')
  })

  it('distinguishes planning, executing, ready and completed phases', () => {
    expect(derivePlanPhase({ status: 'inProgress' })).toBe('planning')
    expect(derivePlanPhase({ status: 'inProgress', plan })).toBe('executing')
    expect(derivePlanPhase({ status: 'completed', plan: { ...plan, final: true } })).toBe(
      'plan-ready',
    )
    expect(derivePlanPhase({ status: 'completed', plan })).toBe('completed')
  })

  it('prioritizes a pending questionnaire over a plan', () => {
    expect(
      derivePlanPhase({
        status: 'inProgress',
        plan: { ...plan, final: true },
        userInput: {
          requestId: 1,
          turnId: 'turn-1',
          itemId: 'item-1',
          questions: [],
          isBlocking: true,
        },
      }),
    ).toBe('questionnaire')
  })
})
