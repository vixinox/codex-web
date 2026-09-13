import type { ThreadClient } from '@/lib/bridge/thread-client'
import type { ComposerCapabilities } from '@/app/chat/composer/composer-capabilities'
import type { ComposerPreferences } from '@/app/chat/composer/composer-store'
import type { ComposerSkill } from '@/app/chat/model/composer-types'

export type AcceptedTurn = { projectId: string | null; threadId: string; turnId: string }

export type ComposerSelectionTarget = { projectId: string | null; threadId: string | null }

/**
 * Per-Thread / New-Chat selection persistence. Owner keeps this in browser
 * storage; a runtime without durable selection omits the seam entirely.
 */
export type ComposerSelectionStore = {
  read(userId: string, target: ComposerSelectionTarget): ComposerPreferences
  write(userId: string, target: ComposerSelectionTarget, preferences: ComposerPreferences): void
}

/**
 * Everything the shared Composer controller needs from a runtime. It exposes
 * only Composer capabilities: no credentials, workspace paths, leases, native
 * Thread internals, or general command/filesystem API.
 */
export type ComposerRuntimeAdapter = {
  capabilities: ComposerCapabilities
  threads: ThreadClient
  selection?: ComposerSelectionStore
  /** Whether an accepted Turn handle is also the native transcript Turn id. */
  acceptedTurnIdIsNative?: boolean
  listSkills(projectId: string | null, signal?: AbortSignal): Promise<readonly ComposerSkill[]>
  /**
   * Runtime-specific copy. `skillsError`/`compactError` replace the message
   * outright; `submitError` is only the fallback for a non-Error throw.
   */
  messages?: {
    skillsError?: string
    submitError?: string
    compactError?: string
  }
  /** Trusted context window for this runtime; `undefined` keeps the display honest. */
  readContextWindow?: (signal?: AbortSignal) => Promise<number | undefined>
  /** Runtime push that invalidates the loaded Skill list, when the runtime has one. */
  subscribeToSkillChanges?(onChange: () => void): () => void
}

export type ComposerHost = {
  target: ComposerSelectionTarget
  activeTurnId?: string | null
  /**
   * Cancels the working Turn when the composition owns which Thread and Turn
   * are active, instead of the current route target.
   */
  cancelActiveTurn?(): Promise<void>
  /** Runtime accepted the Turn; the screen reflects it optimistically. */
  onTurnAccepted(turn: AcceptedTurn): void
  /** Accepted Turn on an existing Thread; the screen refreshes that Thread. */
  onTurnFollowed?(turn: AcceptedTurn): void
  /** Turn created its Thread; the screen navigates to the new Thread. */
  onThreadCreated?(turn: AcceptedTurn): void
  /** Working Turn was cancelled; the screen refreshes or drops optimistic state. */
  onTurnCancelled?(): void
  onUnavailable?(): void
  /** Runtime reported a Composer error the screen should surface outside the composer. */
  onError?(message: string): void
}
