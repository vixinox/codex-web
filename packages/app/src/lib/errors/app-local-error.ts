export const AppLocalErrorCode = {
  ownerRequestTimeout: 'app.owner.request.timeout',
  ownerRequestCancelled: 'app.owner.request.cancelled',
  ownerConnectionUnavailable: 'app.owner.connection.unavailable',
  ownerProtocolInvalidFrame: 'app.owner.protocol.invalid-frame',
  ownerAuthPasskeyRequired: 'app.owner.auth.passkey-required',
} as const

export type AppLocalErrorCode = (typeof AppLocalErrorCode)[keyof typeof AppLocalErrorCode]

export class AppLocalError extends Error {
  readonly code: AppLocalErrorCode

  constructor(code: AppLocalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppLocalError'
    this.code = code
  }
}
