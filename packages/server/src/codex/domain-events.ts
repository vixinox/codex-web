import { DOMAIN_EVENT_RUNTIME, type DomainEventInput } from '@codex-web/protocol/owner'
import { record } from './record.js'

const workspaceMethods = new Set([
  'skills/changed',
  'project/changed',
  'thread/archived',
  'thread/unarchived',
  'thread/closed',
  'thread/deleted',
  'thread/settings/updated',
])

export function workspaceEvent(value: unknown): DomainEventInput | undefined {
  if (!record(value) || typeof value.method !== 'string' || !record(value.params)) return undefined
  if (!workspaceMethods.has(value.method)) return undefined
  return createDomainEvent(`codex.${value.method}`, value.params)
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
