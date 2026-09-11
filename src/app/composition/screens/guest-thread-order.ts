import type { ChatThreadPresentation } from '@/app/chat/model/types'
import type { ThreadSummary } from '@/lib/bridge/thread-client'

export function reconcileGuestThreads(
  current: readonly ChatThreadPresentation[],
  summaries: readonly ThreadSummary[],
): ChatThreadPresentation[] {
  const incomingIds = summaries.map(({ id }) => id)
  const incomingSet = new Set(incomingIds)
  const nextOrder = current.map(({ id }) => id).filter((id) => incomingSet.has(id))
  const knownIds = new Set(nextOrder)

  for (const [index, id] of incomingIds.entries()) {
    if (knownIds.has(id)) continue
    const precedingKnownId = incomingIds
      .slice(0, index)
      .reverse()
      .find((candidate) => knownIds.has(candidate))
    const insertionIndex = precedingKnownId ? nextOrder.indexOf(precedingKnownId) + 1 : 0
    nextOrder.splice(insertionIndex, 0, id)
    knownIds.add(id)
  }

  const currentById = new Map(current.map((thread) => [thread.id, thread]))
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]))
  return nextOrder.flatMap((id) => {
    const summary = summaryById.get(id)
    if (!summary) return []
    const existing = currentById.get(id)
    return [
      existing
        ? {
            ...existing,
            title: summary.title,
            updatedAt: summary.updatedAt,
            isBusy: summary.status === 'active',
          }
        : {
            id: summary.id,
            projectId: null,
            title: summary.title,
            updatedAt: summary.updatedAt,
            isBusy: summary.status === 'active',
            turns: [],
          },
    ]
  })
}

export function replaceGuestThread(
  current: readonly ChatThreadPresentation[],
  presentation: ChatThreadPresentation,
): ChatThreadPresentation[] {
  const index = current.findIndex((thread) => thread.id === presentation.id)
  if (index < 0) return [...current, presentation]
  return current.map((thread, currentIndex) => (currentIndex === index ? presentation : thread))
}

export function promoteGuestThread(
  current: readonly ChatThreadPresentation[],
  threadId: string,
): ChatThreadPresentation[] {
  const thread = current.find(({ id }) => id === threadId)
  return thread ? [thread, ...current.filter(({ id }) => id !== threadId)] : [...current]
}
