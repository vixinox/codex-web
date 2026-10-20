import * as React from 'react'

import { useComposerController } from './use-composer-controller'
import { ownerComposerAdapter } from '../adapters/owner-composer-adapter'
import type { ComposerHost } from '../adapters/composer-adapter'
import type { ComposerSession, ThreadComposerSessionOptions } from '../interface'

export type { ThreadComposerHost, ThreadPageTarget } from '../interface'

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
  onThreadCreationStart,
  onThreadCreationFailed,
  onThreadCreationResolved,
  adapter,
  capabilities,
}: ThreadComposerSessionOptions): ComposerSession {
  const composerHost = React.useMemo<ComposerHost>(
    () => ({
      target: host.target,
      activeTurnId: host.activeTurnId,
      onTurnAccepted: (turn) => host.onTurnAccepted(turn),
      onTurnFollowed: (turn) => host.followTurn(turn.turnId),
      onThreadCreated: (turn) => host.navigateToThread(turn),
      onTurnCancelled: () => host.retry(),
      onUnavailable: host.onUnavailable,
    }),
    [host],
  )
  return useComposerController({
    userId,
    adapter: adapter ?? ownerComposerAdapter,
    capabilities,
    host: composerHost,
    runtimeReady,
    runtimeStatus,
    working,
    tokenUsage,
    threadSelection,
    onPendingChange,
    onThreadCreationStart,
    onThreadCreationFailed,
    onThreadCreationResolved,
  })
}
