import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  OWNER_IPC_MAX_FRAME_BYTES,
  ownerIpcEndpoint,
  sendOwnerIpcRequest,
  startOwnerIpcServer,
} from './ipc.js'

test('Owner IPC dispatches allowlisted commands over a protected local endpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-owner-ipc-'))
  const allowed = new Set(['status'])
  const server = await startOwnerIpcServer(
    root,
    (command, params) => ({ command, params }),
    allowed,
  )
  try {
    await assert.rejects(sendOwnerIpcRequest(server.endpoint, 'status'), /OWNER_NOT_READY/u)
    server.markReady()
    if (process.platform !== 'win32')
      assert.equal((await stat(server.endpoint)).mode & 0o777, 0o600)
    assert.deepEqual(await sendOwnerIpcRequest(server.endpoint, 'status', { detail: true }), {
      command: 'status',
      params: { detail: true },
    })
    await assert.rejects(sendOwnerIpcRequest(server.endpoint, 'sql'), /COMMAND_NOT_ALLOWED/u)
    await assert.rejects(
      sendOwnerIpcRequest(server.endpoint, 'status', 'x'.repeat(OWNER_IPC_MAX_FRAME_BYTES)),
      /OWNER_IPC_FRAME_TOO_LARGE/u,
    )
  } finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Owner IPC endpoint is derived from the canonical data root without embedding it', async () => {
  const endpoint = ownerIpcEndpoint(path.join(tmpdir(), 'private-owner-data'))
  assert.equal(endpoint.includes('private-owner-data'), false)
  if (process.platform === 'win32') assert.match(endpoint, /^\\\\\.\\pipe\\codex-web-owner-/u)
  else assert.match(endpoint, /\.owner-ipc-[a-f0-9]{24}\.sock$/u)
})

test('Owner IPC client fails when the Owner is not listening', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-owner-ipc-offline-'))
  try {
    const endpoint = ownerIpcEndpoint(root)
    await chmod(root, 0o700)
    await assert.rejects(sendOwnerIpcRequest(endpoint, 'status', undefined, 100), /./u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
