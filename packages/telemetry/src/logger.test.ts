import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLogger,
  formatHumanLine,
  formatJsonLine,
  normalizeError,
  parseLogLevel,
  sanitizeLogFields,
  type LogRecord,
} from './logger.js'

test('parseLogLevel defaults to info and accepts supported values', () => {
  assert.equal(parseLogLevel(undefined), 'info')
  assert.equal(parseLogLevel(' WARN '), 'warn')
  assert.throws(() => parseLogLevel('trace'), /Invalid LOG_LEVEL/)
})

test('logger filters by threshold and preserves child bindings', () => {
  const records: LogRecord[] = []
  const logger = createLogger({ sink: (record) => records.push(record), level: 'warn' })
  logger.info('ignored')
  logger.child({ component: 'relay' }).warn('attach.rejected', { role: 'client' })

  assert.equal(records.length, 1)
  assert.equal(records[0]?.event, 'attach.rejected')
  assert.deepEqual(records[0]?.fields, { component: 'relay', role: 'client' })
})

test('sensitive fields and secret-like values are redacted', () => {
  assert.deepEqual(
    sanitizeLogFields({
      apiKey: 'sk-secret',
      note: 'Authorization: Bearer abc123',
      path: 'C:\\Users\\me\\secret',
    }),
    { apiKey: '[redacted]', note: 'Authorization: [redacted]', path: '[redacted]' },
  )
})

test('TTY and collector formatters provide readable text and JSON Lines', () => {
  const record: LogRecord = {
    timestamp: '2026-11-05T00:00:00.000Z',
    level: 'info',
    event: 'owner.started',
    fields: { port: 3000 },
  }
  assert.match(formatHumanLine(record), /INFO  owner\.started port=3000/)
  assert.deepEqual(JSON.parse(formatJsonLine(record)), record)
})

test('runtime callers cannot add object values to log fields', () => {
  assert.deepEqual(sanitizeLogFields({ nested: { secret: 'value' } } as never), {
    nested: '[omitted]',
  })
})

test('sink failure is contained and invokes a fixed fallback without forwarding the error', () => {
  let fallbackCount = 0
  const logger = createLogger({
    level: 'info',
    sink: () => {
      throw new Error('private sink detail')
    },
    onSinkFailure: () => {
      fallbackCount += 1
      throw new Error('fallback failure')
    },
  })

  assert.doesNotThrow(() => logger.error('owner.request.failed', { requestId: 'safe-id' }))
  assert.equal(fallbackCount, 1)
})

test('error normalization is bounded, redacts causes, and omits stacks', () => {
  const error = new Error('Request failed', {
    cause: Object.assign(new Error('token=private-value in /home/user/project'), { code: 'EFAIL' }),
  })
  const normalized = normalizeError(error)
  assert.equal(normalized.message, 'Request failed')
  assert.equal(normalized.cause?.code, 'EFAIL')
  assert.match(normalized.cause?.message ?? '', /token=\[redacted\]/)
  assert.doesNotMatch(JSON.stringify(normalized), /private-value|\/home\/user/)
  assert.equal('stack' in normalized, false)
})
