const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}
const enabled = process.stdout.isTTY || process.stderr.isTTY
function line(label: string, color: string, message: string) {
  const prefix = `[${label.padEnd(7)}]`
  const timestamp = new Date().toISOString()
  console.error(
    enabled
      ? `${color}${timestamp} ${prefix}${colors.reset} ${message}`
      : `${timestamp} ${prefix} ${message}`,
  )
}
export const log = {
  info: (message: string) => line('INFO', colors.blue, message),
  success: (message: string) => line('SUCCESS', colors.green, message),
  warn: (message: string) => line('WARN', colors.yellow, message),
  error: (message: string) => line('ERROR', colors.red, message),
}
/** Renders an unknown value as text without ever falling back to `[object Object]`. */
export function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'undefined') return 'undefined'
  if (value === null) return 'null'
  try {
    return JSON.stringify(value) ?? '[unserializable]'
  } catch {
    return '[unserializable]'
  }
}

export function safeError(error: unknown) {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current) && messages.length < 4) {
    seen.add(current)
    const message = current instanceof Error ? current.message : describeUnknown(current)
    if (message) messages.push(sanitizeErrorMessage(message))
    current = current instanceof Error ? current.cause : undefined
  }
  return messages.join(' <- ').slice(0, 500)
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z]:\\[^\r\n]*/g, '[path]')
    .replace(/[\r\n]+/g, ' ')
}
