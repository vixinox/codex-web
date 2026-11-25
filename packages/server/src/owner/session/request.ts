import type { OwnerErrorDto } from '@codex-web/telemetry/errors'
import type { OwnerStreamResult } from './contracts.js'
import { OwnerMethodError, projectOwnerError } from '../errors.js'

export function isStreamResult(value: unknown): value is OwnerStreamResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'stream' in value &&
    typeof value.stream === 'object' &&
    value.stream !== null &&
    'run' in value.stream &&
    typeof value.stream.run === 'function'
  )
}

export function projectError(
  error: unknown,
  abortCode: 'REQUEST_TIMEOUT' | 'REQUEST_CANCELLED' | undefined,
  detailed: boolean,
): OwnerErrorDto {
  if (abortCode)
    return projectOwnerError(new OwnerMethodError(abortCode, abortCode === 'REQUEST_TIMEOUT'))
  return projectOwnerError(error, detailed)
}

export function abortError(code?: 'REQUEST_TIMEOUT' | 'REQUEST_CANCELLED'): Error {
  return new OwnerMethodError(code ?? 'REQUEST_CANCELLED', code === 'REQUEST_TIMEOUT')
}

export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
        return value
      },
      (error: unknown) => {
        cleanup()
        reject(error)
        return undefined
      },
    )
  })
}
