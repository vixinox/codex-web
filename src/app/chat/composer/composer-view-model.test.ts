import { describe, expect, it } from 'vitest'

import { toComposerUsageView } from './composer-view-model'
import type { ChatTokenUsage } from '@/app/chat/model/types'

function usage(modelContextWindow: number | null): ChatTokenUsage {
  return {
    modelContextWindow,
    last: { inputTokens: 100, outputTokens: 20, reasoningOutputTokens: 10, totalTokens: 130 },
    total: { inputTokens: 300, outputTokens: 50, reasoningOutputTokens: 20, totalTokens: 370 },
  }
}

describe('Composer usage view', () => {
  it('prefers the current Thread snapshot context window over the runtime fallback', () => {
    expect(
      toComposerUsageView({
        thread: { tokenUsage: usage(128_000) },
        contextWindow: 256_000,
        runtimeReady: true,
      }),
    ).toMatchObject({ tokenUsage: usage(128_000), contextWindow: 128_000 })
  })

  it('uses the runtime context window only when the Thread snapshot lacks one', () => {
    expect(
      toComposerUsageView({
        thread: { tokenUsage: usage(null) },
        contextWindow: 256_000,
        runtimeReady: true,
      }).contextWindow,
    ).toBe(256_000)
  })

  it('does not expose a context window before the runtime is ready', () => {
    expect(
      toComposerUsageView({
        thread: { tokenUsage: usage(128_000) },
        contextWindow: 256_000,
        runtimeReady: false,
      }).contextWindow,
    ).toBeUndefined()
  })
})
