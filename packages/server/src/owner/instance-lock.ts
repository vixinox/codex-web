import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Lock acquisition and stale-lock recovery must remain sequential.

const LOCK_DIRECTORY = 'owner-instance.lock'
const INITIALIZING_LOCK_MAX_AGE_MS = 30_000

type LockOwner = { pid: number; token: string }

export type OwnerInstanceLock = { release(): Promise<void> }

export async function acquireOwnerInstanceLock(dataRoot: string): Promise<OwnerInstanceLock> {
  await mkdir(dataRoot, { recursive: true })
  const lockPath = join(dataRoot, LOCK_DIRECTORY)
  const token = randomUUID()

  let attempt = 0
  while (attempt < 2) {
    attempt += 1
    const stagingPath = `${lockPath}.init-${token}`
    try {
      // eslint-disable-next-line no-await-in-loop
      await mkdir(stagingPath, { mode: 0o700 })
      // eslint-disable-next-line no-await-in-loop
      await writeFile(
        join(stagingPath, 'owner.json'),
        JSON.stringify({ pid: process.pid, token }),
        {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        },
      )
      // eslint-disable-next-line no-await-in-loop
      await rename(stagingPath, lockPath)
      return {
        async release() {
          const owner = await readOwner(lockPath)
          if (owner?.pid === process.pid && owner.token === token)
            await rm(lockPath, { recursive: true, force: true })
        },
      }
    } catch (error) {
      // eslint-disable-next-line no-await-in-loop
      await rm(stagingPath, { recursive: true, force: true })
      // eslint-disable-next-line no-await-in-loop
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && !(await pathExists(lockPath)))
        throw error
      // eslint-disable-next-line no-await-in-loop
      if (!(await reclaimStaleLock(lockPath))) throw new OwnerInstanceAlreadyRunningError()
    }
  }

  throw new OwnerInstanceAlreadyRunningError()
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function reclaimStaleLock(lockPath: string) {
  const owner = await readOwner(lockPath)
  if (owner ? isProcessRunning(owner.pid) : await isLockStillInitializing(lockPath)) return false

  const stalePath = `${lockPath}.stale-${randomUUID()}`
  try {
    await rename(lockPath, stalePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  await rm(stalePath, { recursive: true, force: true })
  return true
}

async function readOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'))
    if (
      value &&
      typeof value === 'object' &&
      Number.isSafeInteger((value as LockOwner).pid) &&
      (value as LockOwner).pid > 0 &&
      typeof (value as LockOwner).token === 'string'
    )
      return value as LockOwner
  } catch {
    return null
  }
  return null
}

async function isLockStillInitializing(lockPath: string) {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs < INITIALIZING_LOCK_MAX_AGE_MS
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class OwnerInstanceAlreadyRunningError extends Error {
  constructor() {
    super('OWNER_ALREADY_RUNNING')
    this.name = 'OwnerInstanceAlreadyRunningError'
  }
}
