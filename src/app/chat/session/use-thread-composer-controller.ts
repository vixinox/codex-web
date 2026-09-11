import * as React from 'react'

import { useComposerController } from './use-composer-controller'
import { ownerComposerAdapter } from './owner-composer-adapter'
import type { ComposerHost } from './composer-adapter'
import type { ChatPendingTurn } from '@/app/chat/model/types'
import type { ComposerViewModel } from '@/app/chat/model/composer-types'

export type ThreadPageTarget = { projectId: string | null; threadId: string | null }
export type ThreadComposerHost = {
  target: ThreadPageTarget
  followTurn(turnId: string): void
  retry(): void
  navigateToThread(input: { projectId: string | null; threadId: string; turnId: string }): void
  onTurnAccepted: (input: { projectId: string | null; threadId: string; turnId: string }) => void
  activeTurnId?: string | null
  onUnavailable?: () => void
}

type ThreadComposerOptions = {
  userId: string
  host: ThreadComposerHost
  runtimeReady: boolean
  runtimeStatus?: string
  working: boolean
  tokenUsage?: ComposerViewModel['tokenUsage']
  threadSelection?: Parameters<typeof useComposerController>[0]['threadSelection']
  onPendingChange?: (pending: ChatPendingTurn | null, key: string | null) => void
}

/**
 * Owner Thread Composer: the shared controller wired to the Owner adapter and
 * the Owner screen's navigation/refresh host.
 */
export function useThreadComposerController({
  userId,
  host,
  runtimeReady,
  runtimeStatus,
  working,
  tokenUsage,
  threadSelection,
  onPendingChange,
}: ThreadComposerOptions) {
  const composerHost = React.useMemo<ComposerHost>(
    () => ({
      target: host.target,
      activeTurnId: host.activeTurnId,
      onTurnAccepted: host.onTurnAccepted,
      onTurnFollowed: (turn) => host.followTurn(turn.turnId),
      onThreadCreated: (turn) => host.navigateToThread(turn),
      onTurnCancelled: () => host.retry(),
      onUnavailable: host.onUnavailable,
    }),
    [host],
  )
  return useComposerController({
    userId,
    adapter: ownerComposerAdapter,
    host: composerHost,
    runtimeReady,
    runtimeStatus,
    working,
    tokenUsage,
    threadSelection,
    onPendingChange,
  })
}
