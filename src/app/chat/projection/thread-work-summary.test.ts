import { describe, expect, it } from 'vitest'

import { getTurnWorkLabel } from './thread-work-summary'
import type { ChatTurnPresentation } from '@/app/chat/model/types'

function turn(overrides: Partial<ChatTurnPresentation>): ChatTurnPresentation {
  return { id: 'turn-1', status: 'inProgress', blocks: [], ...overrides }
}

describe('getTurnWorkLabel', () => {
  it('shows a running work timer for an empty turn', () => {
    expect(getTurnWorkLabel(turn({ startedAt: 1_000 }), 3_500)).toBe('Working for 03s')
  })

  it('never reports negative elapsed time', () => {
    expect(getTurnWorkLabel(turn({ startedAt: 3_500 }), 1_000)).toBe('Working for 00s')
  })

  it('prioritizes compacting while a compact item is running', () => {
    expect(
      getTurnWorkLabel(
        turn({
          startedAt: 1_000,
          blocks: [
            {
              id: 'compact-1',
              type: 'article',
              kind: 'context-compaction',
              title: 'Context compacting',
              status: 'running',
            },
          ],
        }),
        3_500,
      ),
    ).toBe('Compacting')
  })

  it('uses terminal duration for completed and interrupted turns', () => {
    expect(getTurnWorkLabel(turn({ status: 'completed', durationMs: 61_000 }), 0)).toBe(
      'Worked for 1m01s',
    )
    expect(getTurnWorkLabel(turn({ status: 'interrupted', durationMs: 2_000 }), 0)).toBe(
      'You stopped after 02s',
    )
  })
})
