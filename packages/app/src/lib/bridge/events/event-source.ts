import { getOwnerBridge } from '../owner-runtime'

export type EventSubscription = {
  events?: readonly string[]
  url?: string
  onEvent: (event: Event) => void
  onError?: () => void
}

export function subscribeToEvents(subscription: EventSubscription): () => void {
  const handle = getOwnerBridge().openStream(
    { method: 'events.subscribe', params: { scope: 'workspace', events: subscription.events } },
    {
      onEvent: (value) => {
        const type =
          value &&
          typeof value === 'object' &&
          'method' in value &&
          typeof value.method === 'string'
            ? value.method
            : 'message'
        subscription.onEvent(new Event(type))
      },
      onError: () => subscription.onError?.(),
      onClose: () => undefined,
    },
  )
  return () => handle.cancel()
}
