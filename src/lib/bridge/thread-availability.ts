export type ThreadAvailabilityFetcher<T> = (signal?: AbortSignal) => Promise<T>

const MAX_AVAILABILITY_ATTEMPTS = 5

/** Retry Thread reads only while the runtime is materializing a new Thread. */
export async function waitForThreadAvailability<T>(
  fetcher: ThreadAvailabilityFetcher<T>,
  signal?: AbortSignal,
) {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_AVAILABILITY_ATTEMPTS; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each retry must observe the previous attempt's outcome
      return await fetcher(signal)
    } catch (error) {
      if (
        signal?.aborted ||
        !isThreadAvailabilityRace(error) ||
        attempt === MAX_AVAILABILITY_ATTEMPTS - 1
      )
        throw error
      lastError = error
      // oxlint-disable-next-line no-await-in-loop -- backoff delays must elapse in retry order
      await waitForRetry(signal, 2 ** attempt * 100)
    }
  }
  throw lastError
}

export function isThreadAvailabilityRace(error: unknown) {
  if (error === null || typeof error !== 'object' || !('status' in error)) return false
  const { status } = error
  return status === 404 || status === 502 || status === 503
}

function waitForRetry(signal: AbortSignal | undefined, delay: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
