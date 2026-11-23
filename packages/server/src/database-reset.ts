import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { ServerConfig } from './config.js'
import { prepareOwnerDatabase } from './database.js'
import { RemoteTrustStore } from './remote/trust-store.js'

/** Reset only the Owner SQLite files and remote peer list; caller must hold the Owner instance lock. */
export async function resetOwnerDatabase(
  config: ServerConfig,
  dependencies: {
    prepare?: typeof prepareOwnerDatabase
    trustStore?: RemoteTrustStore
  } = {},
) {
  await (dependencies.trustStore ?? new RemoteTrustStore(config.dataRoot)).clearPeers()
  await Promise.all(
    ['', '-wal', '-shm'].map((suffix) =>
      rm(path.join(config.dataRoot, `owner.sqlite${suffix}`), { force: true }),
    ),
  )
  ;(dependencies.prepare ?? prepareOwnerDatabase)(config)
}
