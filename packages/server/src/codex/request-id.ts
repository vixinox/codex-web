export type RequestId = number | string

export function parseRequestId(value: string): RequestId {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && value === String(numeric) ? numeric : value
}

export function requestIdCandidates(value: RequestId): RequestId[] {
  const candidates: RequestId[] = [value]
  const alternate =
    typeof value === 'string'
      ? parseRequestId(value)
      : Number.isSafeInteger(value)
        ? String(value)
        : undefined
  if (alternate !== undefined && alternate !== value) candidates.push(alternate)
  return candidates
}
