export type EventSourceSubscription = {
  url: string
  events: readonly string[]
  onEvent: (event: Event) => void
  onError?: () => void
}

export function subscribeToEvents({ url, events, onEvent, onError }: EventSourceSubscription) {
  if (typeof window.EventSource !== 'function') return () => undefined
  const source = new window.EventSource(url)
  for (const eventName of events) source.addEventListener(eventName, onEvent)
  if (onError) source.onerror = onError
  return () => {
    for (const eventName of events) source.removeEventListener(eventName, onEvent)
    source.close()
  }
}
