import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import * as schema from '../src/lib/db/schema.js'
import type { ServerConfig } from './config.js'
import type { Database } from './database.js'

export function createAuth(config: ServerConfig, database: Database) {
  return betterAuth({
    appName: 'Codex Web',
    baseURL: config.authUrl,
    secret: config.authSecret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['x-codex-web-client-ip'],
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
