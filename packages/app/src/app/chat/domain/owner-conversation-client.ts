import type { ConversationChange } from '@codex-web/conversation'
import {
  isConversationSnapshot,
  isOwnerEventErrorCode,
  parseOwnerEventCursor,
  parseOwnerEventStreamMessage,
  type OwnerEventCursor,
} from '@codex-web/protocol/owner'
import type { StreamHandle, StreamHandlers, StreamRequest } from '@/lib/owner-ws/owner-runtime'
import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
import { waitForThreadAvailability } from '@/lib/bridge/thread-availability'
import type { ConversationClient, ConversationTarget } from './conversation-client'

type OwnerConversationPort = {
  read(
    target: ConversationTarget,
    signal: AbortSignal,
  ): Promise<{ snapshot: unknown; cursor: unknown }>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
}

type StreamExit = 'abort' | 'reset' | 'resume'

export function createOwnerConversationClient(
  port: OwnerConversationPort,
): Pick<ConversationClient, 'watch'> {
  return {
    async watch(target, observer, signal) {
      const threadId = target.conversationId
      try {
        while (!signal.aborted) {
          const { snapshot, cursor: rawCursor } = await port.read(target, signal)
          if (signal.aborted) return
          const initialCursor = parseOwnerEventCursor(rawCursor)
          if (
            !initialCursor ||
            !isConversationSnapshot(snapshot) ||
            snapshot.id !== threadId ||
            snapshot.watermark !== initialCursor.sequence
          ) {
            throw new Error('Invalid Owner conversation snapshot.')
          }
          observer.replaceSnapshot(snapshot)

          let cursor = initialCursor
          let subscriptionId: string | undefined
          let lastResumeCursor: OwnerEventCursor | undefined
          const seen = new Map<number, string>()
          let request: StreamRequest = {
            method: 'events.subscribe',
            params: { scope: 'thread', threadId, cursor },
          }
          while (!signal.aborted) {
            const exit = await consumeStream(port, request, signal, {
              onOpen(meta) {
                if (isRecord(meta) && typeof meta.subscriptionId === 'string') {
                  subscriptionId = meta.subscriptionId
                }
              },
              onEvent(value) {
                const parsed = parseOwnerEventStreamMessage(value)
                if (!parsed.ok) throw new Error(parsed.error.message)
                if ('method' in parsed.message) return 'reset'

                const { cursor: next, event } = parsed.message
                if (next.epoch !== cursor.epoch) return
                if (event.threadId !== threadId) throw new Error('Unexpected Owner event thread.')
                const encoding = canonicalJson(event)
                const previous = seen.get(next.sequence)
                if (previous !== undefined && previous !== encoding) {
                  throw new Error('Conflicting Owner event identity.')
                }
                if (next.sequence <= cursor.sequence) return
                if (event.type === 'conversation.change') {
                  // The envelope parser already validates the change at the wire boundary.
                  observer.applyChange(event.payload.change as ConversationChange)
                }
                seen.set(next.sequence, encoding)
                if (seen.size > 2048) {
                  const oldest = seen.keys().next()
                  if (!oldest.done) seen.delete(oldest.value)
                }
                cursor = next
              },
            })
            if (exit === 'abort') return
            if (exit === 'reset') break
            if (!subscriptionId || lastResumeCursor === cursor) {
              throw new Error('Owner conversation stream could not be resumed.')
            }
            lastResumeCursor = cursor
            request = { method: 'events.resume', params: { subscriptionId, cursor } }
          }
        }
      } catch (error) {
        if (!signal.aborted) observer.transportError(error)
      }
    },
  }
}

export const ownerConversationClient = createOwnerConversationClient({
  read: ({ projectId, conversationId }, signal) =>
    readOwnerConversation(projectId, conversationId, signal),
  openStream: (request, handlers) => getOwnerBridge().openStream(request, handlers),
})

export async function readOwnerConversation(
  projectId: string | null,
  threadId: string,
  signal?: AbortSignal,
) {
  const response = await waitForThreadAvailability(
    () => getOwnerBridge().request<unknown>('threads.read', { projectId, threadId }, { signal }),
    signal,
  )
  const snapshot = isRecord(response) ? response.snapshot : undefined
  const cursor = parseOwnerEventCursor(isRecord(response) ? response.watermark : undefined)
  if (
    !cursor ||
    !isConversationSnapshot(snapshot) ||
    snapshot.id !== threadId ||
    snapshot.watermark !== cursor.sequence
  ) {
    throw new Error('Invalid Owner conversation snapshot.')
  }
  return { snapshot, cursor }
}

function consumeStream(
  port: OwnerConversationPort,
  request: StreamRequest,
  signal: AbortSignal,
  handlers: { onOpen(meta: unknown): void; onEvent(value: unknown): 'reset' | void },
): Promise<StreamExit> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve('abort')
      return
    }
    let active = true
    let handle: StreamHandle | undefined
    const abort = () => settle(() => resolve('abort'))
    const settle = (complete: () => void) => {
      if (!active) return
      active = false
      signal.removeEventListener('abort', abort)
      complete()
      handle?.cancel()
    }
    const resume = () => settle(() => resolve('resume'))
    signal.addEventListener('abort', abort, { once: true })
    try {
      handle = port.openStream(request, {
        onOpen: (meta) => {
          if (active) handlers.onOpen(meta)
        },
        onEvent: (value) => {
          if (!active) return
          try {
            if (handlers.onEvent(value) === 'reset') settle(() => resolve('reset'))
          } catch (error) {
            settle(() => reject(error))
          }
        },
        onError: (error) => {
          if ('code' in error && isOwnerEventErrorCode(error.code)) settle(() => reject(error))
          else resume()
        },
        onClose: resume,
      })
      if (!active) handle.cancel()
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, entry: unknown) =>
    isRecord(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  )
}
