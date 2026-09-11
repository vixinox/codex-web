import { describe, expect, it } from 'vitest'

import {
  EMPTY_COMPOSER_USAGE,
  contextUsagePercent,
  formatContextUsage,
  formatTokenTotals,
  resolveComposerUsage,
} from './usage-format'
import type { ChatTokenUsage } from '@/app/chat/model/types'

const usage = (lastTokens: number, totalTokens = 0): ChatTokenUsage => ({
  modelContextWindow: 1000,
  last: { inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: lastTokens },
  total: { inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: totalTokens },
})

describe('composer usage display', () => {
  it('reports unavailable instead of a fabricated percentage without a context window', () => {
    expect(contextUsagePercent(usage(500), undefined)).toBeNull()
    expect(contextUsagePercent(usage(500), 0)).toBeNull()
    expect(formatContextUsage(usage(500), undefined)).toBe('Context window unavailable')
    expect(formatTokenTotals(usage(500), undefined)).toBe('Context window unavailable')
  })

  it('uses last total tokens as context used and total tokens as cumulative', () => {
    expect(contextUsagePercent(usage(250, 900), 1000)).toBe(25)
    expect(formatContextUsage(usage(250, 900), 1000)).toBe('25% used (75% left)')
    expect(formatTokenTotals(usage(250, 900), 1000)).toBe('900 / 1k tokens used')
  })

  it('clamps the used percentage to the 0-100 display range', () => {
    expect(contextUsagePercent(usage(5000), 1000)).toBe(100)
    expect(contextUsagePercent(usage(0), 1000)).toBe(0)
  })

  it('maps a missing Thread snapshot to zero usage without inventing a context window', () => {
    expect(resolveComposerUsage(undefined)).toBe(EMPTY_COMPOSER_USAGE)
    expect(EMPTY_COMPOSER_USAGE.modelContextWindow).toBeNull()
    expect(
      contextUsagePercent(EMPTY_COMPOSER_USAGE, EMPTY_COMPOSER_USAGE.modelContextWindow),
    ).toBeNull()
  })
})
