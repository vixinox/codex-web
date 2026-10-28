import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { acquireOwnerInstanceLock, OwnerInstanceAlreadyRunningError } from './instance-lock.js'

test('Owner instance lock prevents a second writer and releases for the next process', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'owner-instance-lock-'))
  try {
    const first = await acquireOwnerInstanceLock(dataRoot)
    await assert.rejects(() => acquireOwnerInstanceLock(dataRoot), OwnerInstanceAlreadyRunningError)
    await first.release()
    const second = await acquireOwnerInstanceLock(dataRoot)
    await second.release()
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('Owner instance lock can recover a lock left by a dead process', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'owner-instance-lock-stale-'))
  try {
    const lockPath = join(dataRoot, 'owner-instance.lock')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(lockPath)
    await writeFile(
      join(lockPath, 'owner.json'),
      JSON.stringify({ pid: 2_147_483_647, token: 'stale' }),
    )
    const lock = await acquireOwnerInstanceLock(dataRoot)
    await lock.release()
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})
