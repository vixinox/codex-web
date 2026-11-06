import { TelemetryErrorCode, type KnownTelemetryErrorCode } from '@codex-web/telemetry/errors'

export type RelayFailureCode = Extract<KnownTelemetryErrorCode, `relay.${string}`>

export type RelayCloseContext = 'attach' | 'enrollment' | 'frame' | 'text-frame' | 'session-missing'

export type RelayConnectionCloseCode =
  | typeof TelemetryErrorCode.relayConnectionPeerDisconnected
  | typeof TelemetryErrorCode.relayConnectionReplaced
  | typeof TelemetryErrorCode.relayConnectionSlowConsumer
  | typeof TelemetryErrorCode.relayConnectionClosedByOwner

export type RelaySocketClose = { code: number; reason: string }

/** Relay's internal error taxonomy is intentionally projected to a small safe socket vocabulary. */
export function mapRelaySocketClose(
  failure: RelayFailureCode,
  context: RelayCloseContext,
): RelaySocketClose {
  if (context === 'attach') {
    return failure === TelemetryErrorCode.relayAttachOwnerConflict
      ? { code: 1008, reason: 'owner_code_conflict' }
      : { code: 1008, reason: 'attach_rejected' }
  }
  if (context === 'enrollment') return { code: 1008, reason: 'invalid_enrollment_reference' }
  if (context === 'session-missing') return { code: 1008, reason: 'session_not_found' }
  if (context === 'text-frame') return { code: 1003, reason: 'text frames required' }
  if (failure === TelemetryErrorCode.relayFrameTooLarge)
    return { code: 1009, reason: 'frame too large' }
  return { code: 1008, reason: 'invalid_forward_frame' }
}

export function mapRelayConnectionClose(code: RelayConnectionCloseCode): RelaySocketClose {
  switch (code) {
    case TelemetryErrorCode.relayConnectionPeerDisconnected:
      return { code: 4002, reason: 'peer_disconnected' }
    case TelemetryErrorCode.relayConnectionReplaced:
      return { code: 4002, reason: 'replaced' }
    case TelemetryErrorCode.relayConnectionSlowConsumer:
      return { code: 4002, reason: 'slow_consumer' }
    case TelemetryErrorCode.relayConnectionClosedByOwner:
      return { code: 4002, reason: 'closed_by_owner' }
  }
}
