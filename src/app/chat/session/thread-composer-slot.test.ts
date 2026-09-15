import { describe, expect, it } from 'vitest'

import type { ComposerViewModel } from '@/app/chat/model/composer-types'
import { buildThreadComposerSlot } from './thread-composer-slot'

const composer = (error: string | null = null) => ({ error }) as ComposerViewModel

const plan = {
  steps: [],
  diffStats: { files: 0, additions: 0, deletions: 0 },
  final: false,
}

describe('thread composer slot selection', () => {
  it('prioritizes errors over every other slot', () => {
    expect(
      buildThreadComposerSlot(composer('Composer failed'), [{ status: 'inProgress', plan }], {
        requestId: 1,
        turnId: 'turn-1',
        itemId: 'item-1',
        questions: [],
        isBlocking: true,
      }),
    ).toEqual({ kind: 'error', message: 'Composer failed' })
  })

  it('prioritizes a pending questionnaire over a final plan', () => {
    const request = {
      requestId: 'request-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [],
      isBlocking: true,
    }
    expect(
      buildThreadComposerSlot(
        composer(),
        [{ status: 'completed', plan: { ...plan, final: true } }],
        request,
      ),
    ).toEqual({ kind: 'questionnaire', request })
  })

  it('renders the active plan with the normal input slot', () => {
    expect(buildThreadComposerSlot(composer(), [{ status: 'inProgress', plan }])).toEqual({
      kind: 'input',
      composer: composer(),
      plan,
    })
  })

  it('renders a completed final plan as the confirmation slot', () => {
    const finalPlan = { ...plan, final: true }
    expect(buildThreadComposerSlot(composer(), [{ status: 'completed', plan: finalPlan }])).toEqual(
      { kind: 'final-plan', plan: finalPlan },
    )
  })
})
