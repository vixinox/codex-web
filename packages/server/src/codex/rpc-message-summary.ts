import { createHash } from 'node:crypto'

const MAX_DEPTH = 4
const MAX_KEYS_PER_OBJECT = 16
const MAX_ARRAY_ITEMS = 3
const MAX_NODES = 64
const MAX_SUMMARY_LENGTH = 1_000
const MAX_KEY_LENGTH = 48
const SENSITIVE_KEY =
  /api[_-]?key|authorization|bearer|token|secret|password|private[_-]?key|path|cwd|workdir|directory/i

type SummaryState = { nodes: number; truncated: boolean }

export function summarizeRpcShape(value: unknown): string {
  const state: SummaryState = { nodes: 0, truncated: false }
  const summary = summarizeValue(value, 0, state)
  return state.truncated || summary.length > MAX_SUMMARY_LENGTH
    ? `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : summary
}

export function formatRpcMessageId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${value}`
  if (typeof value === 'string') {
    const fingerprint = createHash('sha256').update(value).digest('hex').slice(0, 10)
    return `string:length=${value.length},fingerprint=${fingerprint}`
  }
  return value === undefined ? 'missing' : typeof value
}

function summarizeValue(value: unknown, depth: number, state: SummaryState): string {
  state.nodes++
  if (state.nodes > MAX_NODES) {
    state.truncated = true
    return '…'
  }
  if (value === null) return 'null'
  if (typeof value === 'string') return `string(chars=${value.length})`
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      state.truncated = true
      return `array(length=${value.length},items=…)`
    }
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => summarizeValue(item, depth + 1, state))
    if (value.length > MAX_ARRAY_ITEMS) state.truncated = true
    return `array(length=${value.length},items=[${items.join(',')}])`
  }
  if (typeof value !== 'object') return typeof value
  if (depth >= MAX_DEPTH) {
    state.truncated = true
    return 'object(keys=…)'
  }

  const objectValue = value as Record<string, unknown>
  const fields: string[] = []
  let omitted = false
  for (const key in objectValue) {
    if (!Object.hasOwn(objectValue, key)) continue
    if (state.nodes >= MAX_NODES) {
      omitted = true
      state.truncated = true
      break
    }
    if (fields.length >= MAX_KEYS_PER_OBJECT) {
      omitted = true
      break
    }
    fields.push(`${summarizeKey(key)}:${summarizeValue(objectValue[key], depth + 1, state)}`)
    if (state.nodes > MAX_NODES) break
  }
  if (omitted) state.truncated = true
  return `object(${fields.join(',')}${omitted ? ',…' : ''})`
}

function summarizeKey(value: string) {
  if (SENSITIVE_KEY.test(value) || /[A-Za-z]:[\\/]|^(?:\\\\|\/)/.test(value))
    return '[sensitive-key]'
  const safe = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
    .slice(0, MAX_KEY_LENGTH)
  return safe || '[empty-key]'
}
