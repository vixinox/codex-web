export type RemoteAuthState =
  | 'unknown'
  | 'needs_login'
  | 'pending_device_approval'
  | 'pending_totp'
  | 'temporary_authenticated'
  | 'paired'
  | 'expired'
  | 'revoked'
  | 'failed'

export type RemoteConnectionState =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'failed'

export function canInvokeRemoteMethod(auth: RemoteAuthState, method: string) {
  if (method === 'owner.status' || method === 'owner.session.open') return true
  if (auth === 'pending_totp') return method === 'remote.device.binding.verifyTotp'
  if (auth === 'pending_device_approval') return method === 'remote.device.binding.status'
  if (auth === 'temporary_authenticated') return method === 'remote.device.trust'
  return auth === 'paired'
}
