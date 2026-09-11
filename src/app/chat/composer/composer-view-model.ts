import { resolveComposerUsage } from './usage-format'
import type { ChatTokenUsage } from '@/app/chat/model/types'

export type ComposerUsageView = {
  /** Context used/total for the current Thread; zero when no snapshot exists. */
  tokenUsage: ChatTokenUsage
  /**
   * Denominator for the context percentage. `undefined` means "not trustworthily
   * known", which the renderer shows as `Context window unavailable` rather than
   * inventing a capacity.
   */
  contextWindow?: number
}

/**
 * Thread snapshot usage to Composer view model. This is the single mapping the
 * Composer usage display consumes: the snapshot owns `tokenUsage`, the runtime
 * owns `contextWindow`, and a not-yet-ready runtime exposes no denominator.
 *
 * Daily Guest quota and `maxTokensPerTurn` are deliberately not inputs here:
 * neither is a context window.
 */
export function toComposerUsageView({
  thread,
  contextWindow,
  runtimeReady,
}: {
  thread?: { tokenUsage?: ChatTokenUsage } | null
  contextWindow?: number
  runtimeReady: boolean
}): ComposerUsageView {
  const tokenUsage = resolveComposerUsage(thread?.tokenUsage)
  const snapshotContextWindow = tokenUsage.modelContextWindow
  const resolvedContextWindow = validContextWindow(snapshotContextWindow)
    ? snapshotContextWindow
    : validContextWindow(contextWindow)
      ? contextWindow
      : undefined
  return {
    tokenUsage,
    ...(runtimeReady && resolvedContextWindow !== undefined
      ? { contextWindow: resolvedContextWindow }
      : {}),
  }
}

function validContextWindow(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
