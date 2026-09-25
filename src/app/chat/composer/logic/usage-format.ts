import type { ChatTokenUsage } from '@/app/chat/model/types'

/**
 * Composer usage describes the current Thread snapshot only. Guest capacity
 * and Owner context-window configuration are separate values and are never
 * derived from these numbers.
 */
export const EMPTY_COMPOSER_USAGE: ChatTokenUsage = {
  modelContextWindow: null,
  last: { inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
  total: { inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
}

export function resolveComposerUsage(usage: ChatTokenUsage | undefined) {
  return usage ?? EMPTY_COMPOSER_USAGE
}

export function contextUsagePercent(usage: ChatTokenUsage | undefined, contextWindow?: number) {
  if (!contextWindow || contextWindow <= 0) return null
  return Math.min(
    100,
    Math.max(0, Math.round(((usage?.last.totalTokens ?? 0) / contextWindow) * 100)),
  )
}

export function formatContextUsage(usage: ChatTokenUsage | undefined, contextWindow?: number) {
  const used = contextUsagePercent(usage, contextWindow)
  if (used === null) return 'Context window unavailable'
  return `${used}% used (${100 - used}% left)`
}

export function formatTokenCount(value: number) {
  if (!value) return '0'
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

export function formatTokenTotals(usage: ChatTokenUsage | undefined, contextWindow?: number) {
  if (!contextWindow || contextWindow <= 0) return 'Context window unavailable'
  return `${formatTokenCount(usage?.total.totalTokens ?? 0)} / ${formatTokenCount(contextWindow)} tokens used`
}
