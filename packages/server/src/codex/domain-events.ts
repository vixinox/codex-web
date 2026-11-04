import { projectNativeMessage, projectNativeThread, record } from './native-protocol.js'
import {
  DOMAIN_EVENT_RUNTIME,
  MAX_DOMAIN_EVENT_PAYLOAD_BYTES,
  type DomainEventEnvelope,
  type DomainEventInput,
} from '@codex-web/protocol/owner'

export { DOMAIN_EVENT_RUNTIME, MAX_DOMAIN_EVENT_PAYLOAD_BYTES }
export type { DomainEventEnvelope, DomainEventInput }

export type RuntimeEventEnvelope = {
  runtime: typeof DOMAIN_EVENT_RUNTIME
  method: string
  id?: number | string
  params: Record<string, unknown>
}

export type RuntimeDiagnostic = {
  runtime: typeof DOMAIN_EVENT_RUNTIME
  method?: string
  code: 'INVALID_MESSAGE' | 'INVALID_PARAMS'
  detail?: string
}

export type RuntimeExtensionEvent = DomainEventInput & {
  type: 'runtime.extension'
}

export type RuntimeAdapterResult =
  | { kind: 'event'; event: DomainEventInput }
  | { kind: 'extension'; event: RuntimeExtensionEvent }
  | { kind: 'invalid'; diagnostic: RuntimeDiagnostic }

export function adaptCodexMessage(
  value: unknown,
  now = new Date().toISOString(),
): RuntimeAdapterResult {
  if (!record(value) || typeof value.method !== 'string' || !record(value.params))
    return {
      kind: 'invalid',
      diagnostic: {
        runtime: DOMAIN_EVENT_RUNTIME,
        code: 'INVALID_MESSAGE',
        detail: 'A Codex notification must contain a method and object params.',
      },
    }

  const raw: RuntimeEventEnvelope = {
    runtime: DOMAIN_EVENT_RUNTIME,
    method: value.method,
    params: value.params,
    ...(typeof value.id === 'number' || typeof value.id === 'string' ? { id: value.id } : {}),
  }
  const projected = projectNativeMessage(raw)
  if (projected.ok) {
    const params = projected.value.params ?? {}
    const ids = correlationIds(raw.params, params)
    return {
      kind: 'event',
      event: {
        type: domainType(raw.method),
        runtime: DOMAIN_EVENT_RUNTIME,
        createdAt: now,
        payload: params,
        ...(ids.threadId ? { threadId: ids.threadId } : {}),
        ...(ids.turnId ? { turnId: ids.turnId } : {}),
        ...(ids.itemId ? { itemId: ids.itemId } : {}),
        ...(ids.requestId !== undefined ? { requestId: ids.requestId } : {}),
      },
    }
  }

  return {
    kind: 'extension',
    event: {
      type: 'runtime.extension',
      runtime: DOMAIN_EVENT_RUNTIME,
      createdAt: now,
      payload: extensionPayload(raw),
      ...(typeof raw.params.threadId === 'string' ? { threadId: raw.params.threadId } : {}),
      ...(typeof raw.params.turnId === 'string' ? { turnId: raw.params.turnId } : {}),
      ...(typeof raw.params.itemId === 'string' ? { itemId: raw.params.itemId } : {}),
      ...(typeof raw.id === 'number' || typeof raw.id === 'string' ? { requestId: raw.id } : {}),
    },
  }
}

export function createDomainEvent(
  type: string,
  payload: Record<string, unknown> = {},
  ids: Pick<DomainEventInput, 'threadId' | 'turnId' | 'itemId' | 'requestId'> = {},
  now = new Date().toISOString(),
): DomainEventInput {
  return {
    type,
    runtime: DOMAIN_EVENT_RUNTIME,
    createdAt: now,
    payload,
    ...(ids.threadId ? { threadId: ids.threadId } : {}),
    ...(ids.turnId ? { turnId: ids.turnId } : {}),
    ...(ids.itemId ? { itemId: ids.itemId } : {}),
    ...(ids.requestId !== undefined ? { requestId: ids.requestId } : {}),
  }
}

export function projectDomainEvent(event: DomainEventEnvelope): DomainEventEnvelope {
  return {
    ...event,
    payload: limitPayload(event.payload),
  }
}

export function domainEventThreadId(event: DomainEventEnvelope): string | undefined {
  return event.threadId
}

export function domainEventToNotification(event: DomainEventEnvelope) {
  const method = event.type.startsWith('codex.') ? event.type.slice('codex.'.length) : event.type
  return {
    method,
    params: event.payload,
    ...(event.requestId !== undefined ? { id: event.requestId } : {}),
  }
}

export function projectThreadSnapshot(value: unknown, projectPath?: string) {
  return projectNativeThread(value, projectPath)
}

function domainType(method: string) {
  return `codex.${method}`
}

function correlationIds(
  raw: {
    threadId?: unknown
    turnId?: unknown
    itemId?: unknown
    requestId?: unknown
    id?: unknown
  },
  params: Record<string, unknown>,
) {
  const threadId =
    stringValue(raw.threadId) ??
    stringValue(params.threadId) ??
    (record(params.thread) ? stringValue(params.thread.id) : undefined) ??
    (record(params.turn) ? stringValue(params.turn.threadId) : undefined)
  const turn = record(params.turn) ? params.turn : undefined
  const turnId = stringValue(raw.turnId) ?? stringValue(params.turnId) ?? stringValue(turn?.id)
  const item = record(params.item) ? params.item : undefined
  const itemId = stringValue(raw.itemId) ?? stringValue(params.itemId) ?? stringValue(item?.id)
  const requestId =
    raw.requestId ??
    params.requestId ??
    (typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : undefined)
  return {
    threadId,
    turnId,
    itemId,
    requestId:
      typeof requestId === 'number' || typeof requestId === 'string' ? requestId : undefined,
  }
}

function extensionPayload(value: RuntimeEventEnvelope) {
  const ids = correlationIds(value.params, value.params)
  return limitPayload({
    method: value.method,
    params: redactFields(value.params),
    ...(ids.threadId ? { threadId: ids.threadId } : {}),
    ...(ids.turnId ? { turnId: ids.turnId } : {}),
    ...(ids.itemId ? { itemId: ids.itemId } : {}),
  })
}

function limitPayload(value: Record<string, unknown>): Record<string, unknown> {
  const encoded = JSON.stringify(value)
  const bytes = Buffer.byteLength(encoded, 'utf8')
  if (bytes <= MAX_DOMAIN_EVENT_PAYLOAD_BYTES) return value
  let low = 0
  let high = encoded.length
  let best: Record<string, unknown> = { truncated: true, payloadBytes: bytes, content: '' }
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const end =
      middle > 0 && middle < encoded.length && isHighSurrogate(encoded.charCodeAt(middle - 1))
        ? middle - 1
        : middle
    const candidate = {
      truncated: true,
      payloadBytes: bytes,
      content: encoded.slice(0, end),
    }
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_DOMAIN_EVENT_PAYLOAD_BYTES) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

function redactFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) =>
      /api[_-]?key|authorization|bearer|token|secret|password|private[_-]?key|path|cwd|workdir|directory/i.test(
        key,
      )
        ? [key, '[redacted]']
        : [key, redactNested(entry)],
    ),
  )
}

function redactNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNested)
  if (!record(value)) return value
  return redactFields(value)
}

function isHighSurrogate(value: number) {
  return value >= 0xd800 && value <= 0xdbff
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
