import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CodexStdioTransport, parseJsonRpcLine } from './stdio-transport.js'

const fixture = fileURLToPath(new URL('./fixtures/stdio-child.mjs', import.meta.url))

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for child process')), 5_000),
    ),
  ])
}

test('parseJsonRpcLine accepts object messages and ignores other output', () => {
  assert.deepEqual(parseJsonRpcLine('{"jsonrpc":"2.0","id":1}'), { jsonrpc: '2.0', id: 1 })
  assert.equal(parseJsonRpcLine('diagnostic output'), undefined)
  assert.equal(parseJsonRpcLine('[]'), undefined)
  assert.equal(parseJsonRpcLine('null'), undefined)
})

test('sends newline-delimited JSON and receives protocol messages', async () => {
  const transport = new CodexStdioTransport({
    executable: process.execPath,
    args: [fixture, 'echo'],
  })
  const message = withTimeout(
    new Promise<Record<string, unknown>>((resolve) => transport.onMessage(resolve)),
  )
  const stderr = withTimeout(new Promise<string>((resolve) => transport.onStderr(resolve)))
  const exited = withTimeout(
    new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      transport.onExit((...result) => resolve(result)),
    ),
  )

  transport.send({ jsonrpc: '2.0', id: 7, method: 'fixture/echo' })

  assert.deepEqual(await message, { jsonrpc: '2.0', id: 7, method: 'fixture/echo' })
  assert.equal(await stderr, 'fixture warning')
  assert.deepEqual(await exited, [0, null])
})

test('reports a non-zero child process exit', async () => {
  const transport = new CodexStdioTransport({
    executable: process.execPath,
    args: [fixture, 'exit', '7'],
  })
  const result = await withTimeout(
    new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      transport.onExit((...exit) => resolve(exit)),
    ),
  )
  assert.deepEqual(result, [7, null])
})

test('reports process startup errors', async () => {
  const transport = new CodexStdioTransport({ executable: `missing-codex-${process.pid}` })
  const error = await withTimeout(new Promise<Error>((resolve) => transport.onError(resolve)))
  assert.match(error.message, /ENOENT|not found/i)
})

test('stops a running child process', async () => {
  const transport = new CodexStdioTransport({
    executable: process.execPath,
    args: [fixture, 'wait'],
  })
  const exited = withTimeout(
    new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      transport.onExit((...result) => resolve(result)),
    ),
  )
  transport.stop()
  const [code, signal] = await exited
  assert.equal(code, null)
  assert.ok(signal)
})

test('event subscriptions can be removed', () => {
  const transport = new CodexStdioTransport({
    executable: process.execPath,
    args: [fixture, 'wait'],
  })
  const listener = () => {}
  assert.equal(transport.onMessage(listener)(), true)
  assert.equal(transport.onError(listener)(), true)
  assert.equal(transport.onStderr(listener)(), true)
  transport.stop()
})
