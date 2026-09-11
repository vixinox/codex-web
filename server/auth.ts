import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins/anonymous'

import * as schema from '../src/lib/db/schema.js'
import type { ServerConfig } from './config.js'
import type { Database } from './database.js'

export type UserKind = 'owner' | 'guest' | 'admin'

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
    user: {
      additionalFields: {
        kind: {
          type: 'string',
          defaultValue: 'owner',
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.isAnonymous) {
              return {
                data: {
                  ...user,
                  kind: 'guest',
                },
              }
            }
            const kind = user.kind as string | undefined
            if (kind !== 'owner' && kind !== 'admin') {
              throw new Error('Account kind must be owner or admin')
            }
            if (config.mode === 'owner' && kind !== 'owner') {
              throw new Error('Owner profile only accepts owner accounts')
            }
            if (config.mode === 'guest' && kind !== 'admin') {
              throw new Error('Guest profile only accepts admin accounts')
            }
          },
        },
      },
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
    plugins: [anonymous()],
  })
}

export type Auth = ReturnType<typeof createAuth>
