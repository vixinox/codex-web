import {
  isKnownTelemetryErrorCode,
  isPublicErrorDto,
  TelemetryErrorCode,
  type KnownTelemetryErrorCode,
  type PublicErrorDto,
} from '@codex-web/telemetry/errors'
import { AppLocalError, type AppLocalErrorCode } from './app-local-error'

type LocalizedCopy = { en: string; zh: string }
type OwnerErrorCode = Extract<KnownTelemetryErrorCode, `owner.${string}`>

export const OWNER_ERROR_COPY: Record<OwnerErrorCode, LocalizedCopy> = {
  [TelemetryErrorCode.ownerProtocolInvalidFrame]: {
    en: 'The Owner sent an invalid message. Reconnect and try again.',
    zh: 'Owner 发送了无效消息。请重新连接后重试。',
  },
  [TelemetryErrorCode.ownerProtocolFrameTooLarge]: {
    en: 'The Owner message was too large. Reconnect and try again.',
    zh: 'Owner 消息过大。请重新连接后重试。',
  },
  [TelemetryErrorCode.ownerProtocolTextFrameRequired]: {
    en: 'The Owner sent an unsupported message format.',
    zh: 'Owner 发送了不受支持的消息格式。',
  },
  [TelemetryErrorCode.ownerProtocolInvalidHandshake]: {
    en: 'The Owner connection could not be established. Reconnect and try again.',
    zh: '无法建立 Owner 连接。请重新连接后重试。',
  },
  [TelemetryErrorCode.ownerAuthUnauthorized]: {
    en: 'Sign in to continue.',
    zh: '请登录后继续。',
  },
  [TelemetryErrorCode.ownerAuthLocalTransportRequired]: {
    en: 'This action is available from the local Owner connection only.',
    zh: '此操作只能通过本地 Owner 连接执行。',
  },
  [TelemetryErrorCode.ownerAuthOriginNotAllowed]: {
    en: 'This browser origin is not allowed to sign in to Owner.',
    zh: '此浏览器来源不允许登录 Owner。',
  },
  [TelemetryErrorCode.ownerAuthUnavailable]: {
    en: 'Owner authentication is temporarily unavailable. Try again.',
    zh: 'Owner 身份验证暂时不可用，请重试。',
  },
  [TelemetryErrorCode.ownerAuthPasskeyInvalid]: {
    en: 'The Passkey could not be verified. Try again.',
    zh: '无法验证此 Passkey，请重试。',
  },
  [TelemetryErrorCode.ownerAuthPasskeyRequired]: {
    en: 'A Passkey is required to continue.',
    zh: '需要 Passkey 才能继续。',
  },
  [TelemetryErrorCode.ownerAuthChallengeExpired]: {
    en: 'The sign-in request expired. Start again.',
    zh: '登录请求已过期，请重新开始。',
  },
  [TelemetryErrorCode.ownerAuthSessionRevoked]: {
    en: 'This session is no longer active. Sign in again.',
    zh: '此会话已失效，请重新登录。',
  },
  [TelemetryErrorCode.ownerAuthSessionExpired]: {
    en: 'Your session expired. Sign in again.',
    zh: '会话已过期，请重新登录。',
  },
  [TelemetryErrorCode.ownerAuthStepUpRequired]: {
    en: 'Sign in again to confirm this action.',
    zh: '请重新登录以确认此操作。',
  },
  [TelemetryErrorCode.ownerEnrollmentTicketInvalid]: {
    en: 'This enrollment ticket is invalid or has expired.',
    zh: '此注册票据无效或已过期。',
  },
  [TelemetryErrorCode.ownerRequestDuplicateId]: {
    en: 'This request was already received. Try again.',
    zh: '此请求已被接收，请重试。',
  },
  [TelemetryErrorCode.ownerRequestLimitExceeded]: {
    en: 'Owner is handling too many requests. Try again shortly.',
    zh: 'Owner 正在处理过多请求，请稍后重试。',
  },
  [TelemetryErrorCode.ownerRequestTimeout]: {
    en: 'The request timed out. Try again.',
    zh: '请求超时，请重试。',
  },
  [TelemetryErrorCode.ownerRequestCancelled]: {
    en: 'The request was cancelled.',
    zh: '请求已取消。',
  },
  [TelemetryErrorCode.ownerRequestMethodNotFound]: {
    en: 'Owner does not support this operation.',
    zh: 'Owner 不支持此操作。',
  },
  [TelemetryErrorCode.ownerRequestInvalidParams]: {
    en: 'The request contains invalid information.',
    zh: '请求中包含无效信息。',
  },
  [TelemetryErrorCode.ownerInternalUnavailable]: {
    en: 'Owner could not complete this operation. Try again.',
    zh: 'Owner 无法完成此操作，请重试。',
  },
  [TelemetryErrorCode.ownerStreamBackpressureLimit]: {
    en: 'The live update stream is busy. Reconnect and try again.',
    zh: '实时更新流繁忙。请重新连接后重试。',
  },
  [TelemetryErrorCode.ownerEventsSubscriptionExpired]: {
    en: 'The live update subscription expired. Reconnect and try again.',
    zh: '实时更新订阅已过期。请重新连接后重试。',
  },
  [TelemetryErrorCode.ownerEventsInvalidCursor]: {
    en: 'The update history is no longer available. Refresh and try again.',
    zh: '更新历史已不可用，请刷新后重试。',
  },
  [TelemetryErrorCode.ownerEventsInvalidStream]: {
    en: 'The live update stream could not be validated. Reconnect and try again.',
    zh: '无法验证实时更新流。请重新连接后重试。',
  },
  [TelemetryErrorCode.ownerSetupAlreadyInitialized]: {
    en: 'Owner setup has already been completed.',
    zh: 'Owner 初始化已完成。',
  },
  [TelemetryErrorCode.ownerCredentialInvalid]: {
    en: 'The credential is invalid. Check it and try again.',
    zh: '凭据无效，请检查后重试。',
  },
  [TelemetryErrorCode.ownerCredentialNotFound]: {
    en: 'The credential could not be found.',
    zh: '找不到此凭据。',
  },
  [TelemetryErrorCode.ownerProjectNotFound]: {
    en: 'The project could not be found. Refresh the workspace and try again.',
    zh: '找不到此项目。请刷新工作区后重试。',
  },
  [TelemetryErrorCode.ownerProjectAlreadyExists]: {
    en: 'A project with this name already exists.',
    zh: '已存在同名项目。',
  },
  [TelemetryErrorCode.ownerThreadNotFound]: {
    en: 'The thread could not be found. Refresh and try again.',
    zh: '找不到此会话，请刷新后重试。',
  },
  [TelemetryErrorCode.ownerThreadInvalidId]: {
    en: 'The thread identifier is invalid.',
    zh: '会话标识无效。',
  },
  [TelemetryErrorCode.ownerThreadInvalidQuery]: {
    en: 'The thread request is invalid. Refresh and try again.',
    zh: '会话请求无效，请刷新后重试。',
  },
  [TelemetryErrorCode.ownerRuntimeStartRequired]: {
    en: 'Start Codex before continuing.',
    zh: '请先启动 Codex。',
  },
  [TelemetryErrorCode.ownerRuntimeInvalidResponse]: {
    en: 'Codex returned an invalid response. Try again.',
    zh: 'Codex 返回了无效响应，请重试。',
  },
  [TelemetryErrorCode.ownerRuntimeUnavailable]: {
    en: 'Codex is temporarily unavailable. Try again.',
    zh: 'Codex 暂时不可用，请重试。',
  },
  [TelemetryErrorCode.ownerTurnInvalidRequest]: {
    en: 'This message could not be sent. Review it and try again.',
    zh: '无法发送此消息，请检查后重试。',
  },
  [TelemetryErrorCode.ownerResourceNotFound]: {
    en: 'The requested resource could not be found.',
    zh: '找不到所需资源。',
  },
  [TelemetryErrorCode.ownerRemoteUnavailable]: {
    en: 'The remote Owner is unavailable. Check the connection and try again.',
    zh: '远程 Owner 不可用，请检查连接后重试。',
  },
  [TelemetryErrorCode.ownerRemoteRelayRequired]: {
    en: 'Connect through the configured Relay to use this remote device.',
    zh: '请通过已配置的 Relay 连接以使用此远程设备。',
  },
  [TelemetryErrorCode.ownerDeviceNotFound]: {
    en: 'The device could not be found. Refresh and try again.',
    zh: '找不到此设备，请刷新后重试。',
  },
}

const APP_ERROR_COPY: Record<AppLocalErrorCode, LocalizedCopy> = {
  'app.owner.request.timeout': {
    en: 'The request timed out. Try again.',
    zh: '请求超时，请重试。',
  },
  'app.owner.request.cancelled': {
    en: 'The request was cancelled.',
    zh: '请求已取消。',
  },
  'app.owner.connection.unavailable': {
    en: 'Owner is unavailable. Check the connection and try again.',
    zh: 'Owner 不可用，请检查连接后重试。',
  },
  'app.owner.protocol.invalid-frame': {
    en: 'Owner sent an invalid message. Reconnect and try again.',
    zh: 'Owner 发送了无效消息。请重新连接后重试。',
  },
  'app.owner.auth.passkey-required': {
    en: 'A Passkey is required to continue.',
    zh: '需要 Passkey 才能继续。',
  },
}

const GENERIC_ERROR_COPY: LocalizedCopy = {
  en: 'Something went wrong. Please try again.',
  zh: '发生错误，请重试。',
}

export function presentPublicError(error: unknown, locale = currentLocale()): string {
  if (!isPublicErrorDto(error) || !error.code.startsWith('owner.'))
    return localized(GENERIC_ERROR_COPY, locale)
  const copy =
    isKnownTelemetryErrorCode(error.code) && error.code.startsWith('owner.')
      ? OWNER_ERROR_COPY[error.code as OwnerErrorCode]
      : null
  if (!copy) return error.message ?? localized(GENERIC_ERROR_COPY, locale)
  if (error.code === TelemetryErrorCode.ownerEnrollmentTicketInvalid) {
    const reason = error.params?.reason
    if (reason === 'required')
      return locale.startsWith('zh')
        ? '需要有效的注册票据才能继续。'
        : 'A valid enrollment ticket is required to continue.'
    if (reason === 'expired')
      return locale.startsWith('zh')
        ? '此注册票据已过期。请重新申请。'
        : 'This enrollment ticket has expired. Request a new one.'
  }
  return localized(copy, locale)
}

export function presentAppError(
  error: unknown,
  fallback?: string,
  locale = currentLocale(),
): string {
  const publicError = getPublicError(error)
  if (publicError) return presentPublicError(publicError, locale)
  if (error instanceof AppLocalError) {
    if (error.code === 'app.owner.auth.passkey-required') return error.message
    return localized(APP_ERROR_COPY[error.code], locale)
  }
  return fallback ?? localized(GENERIC_ERROR_COPY, locale)
}

function getPublicError(value: unknown): PublicErrorDto | null {
  if (isPublicErrorDto(value)) return value
  if (!isRecord(value) || !('publicError' in value)) return null
  return isPublicErrorDto(value.publicError) ? value.publicError : null
}

function currentLocale() {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en'
}

function localized(copy: LocalizedCopy, locale: string) {
  return locale.toLowerCase().startsWith('zh') ? copy.zh : copy.en
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
