import assert from 'node:assert/strict'
import test from 'node:test'

import { CodexRpcClient, type RpcTransport } from './rpc-client.js'
import type { JsonRpcMessage } from './stdio-transport.js'

class FakeTransport implements RpcTransport {
  sent: JsonRpcMessage[] = []
  stopped = false
  private message?: (message: JsonRpcMessage) => void
  private error?: (error: Error) => void
  private exit?: (code: number | null, signal: NodeJS.Signals | null) => void
  send(message: JsonRpcMessage) {
    this.sent.push(message)
  }
  stop() {
    this.stopped = true
  }
  onMessage(listener: (message: JsonRpcMessage) => void) {
    this.message = listener
    return () => true
  }
  onError(listener: (error: Error) => void) {
    this.error = listener
    return () => true
  }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.exit = listener
    return () => true
  }
  receive(message: JsonRpcMessage) {
    this.message?.(message)
  }
  fail(error: Error) {
    this.error?.(error)
  }
  close() {
    this.exit?.(1, null)
  }
}

test('correlates JSON-RPC responses and forwards notifications', async () => {
  const transport = new FakeTransport()
  const client = new CodexRpcClient(transport)
  const events: JsonRpcMessage[] = []
  client.onEvent((event) => events.push(event))
  const response = client.request('thread/read', { threadId: 'thr_1' })
  assert.deepEqual(transport.sent[0], {
    method: 'thread/read',
    id: 1,
    params: { threadId: 'thr_1' },
  })
  transport.receive({ method: 'turn/started', params: { threadId: 'thr_1' } })
  transport.receive({ id: 1, result: { thread: { id: 'thr_1' } } })
  assert.deepEqual(await response, { thread: { id: 'thr_1' } })
  assert.equal(events.length, 1)
})

test('rejects pending requests when the process exits', async () => {
  const transport = new FakeTransport()
  const client = new CodexRpcClient(transport)
  const pending = client.request('thread/list')
  transport.close()
  await assert.rejects(pending, /exited/)
})

test('aborting a request removes it from pending and does not send a response later', async () => {
  const transport = new FakeTransport()
  const client = new CodexRpcClient(transport)
  const controller = new AbortController()
  const pending = client.request('turn/start', {}, controller.signal)
  controller.abort(new Error('cancelled'))
  await assert.rejects(pending, /cancelled/)
  transport.receive({ id: 1, result: { ignored: true } })
  const next = client.request('thread/read')
  assert.equal(transport.sent.at(-1)?.id, 2)
  client.stop()
  await assert.rejects(next, /stopped/)
})

test('performs the initialize handshake', async () => {
  const transport = new FakeTransport()
  const client = new CodexRpcClient(transport)
  const initialized = client.initialize()
  transport.receive({ id: 1, result: { userAgent: 'fixture' } })
  await initialized
  assert.equal(transport.sent[0]?.method, 'initialize')
  assert.deepEqual(transport.sent[1], { method: 'initialized', params: {} })
})
