import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const timestamp = (name: string) => integer(name, { mode: 'timestamp' })

export const owner = sqliteTable('owner', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  runtimeInitializedAt: timestamp('runtime_initialized_at'),
  remotePasskeyConfiguredAt: timestamp('remote_passkey_configured_at'),
  localPasskeyConfiguredAt: timestamp('local_passkey_configured_at'),
  currentCredentialId: text('current_credential_id'),
})

export const passkeyCredential = sqliteTable(
  'passkey_credential',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports', { mode: 'json' }).$type<string[]>().notNull(),
    origin: text('origin').notNull(),
    rpId: text('rp_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: timestamp('last_used_at'),
  },
  (table) => [index('passkey_credential_owner_origin_idx').on(table.ownerId, table.origin)],
)

export const localEnrollmentTicket = sqliteTable('local_enrollment_ticket', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => owner.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  rpId: text('rp_id').notNull(),
  purpose: text('purpose').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
})

export const remoteDevice = sqliteTable(
  'remote_device',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull().unique(),
    label: text('label'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: timestamp('last_seen_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [index('remote_device_owner_idx').on(table.ownerId)],
)

export const ownerSession = sqliteTable(
  'owner_session',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').references(() => remoteDevice.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    trustEpoch: integer('trust_epoch').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: timestamp('last_used_at')
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: timestamp('expires_at').notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [index('owner_session_owner_device_idx').on(table.ownerId, table.deviceId)],
)

export const project = sqliteTable(
  'project',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('project_owner_idx').on(table.ownerId),
    uniqueIndex('project_owner_name_unique').on(table.ownerId, table.name),
    uniqueIndex('project_owner_path_unique').on(table.ownerId, table.path),
  ],
)

export const credential = sqliteTable(
  'credential',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    baseUrl: text('base_url').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('credential_owner_idx').on(table.ownerId)],
)

export const domainEvent = sqliteTable(
  'domain_events',
  {
    id: integer('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    threadId: text('thread_id'),
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('domain_events_owner_idx').on(table.ownerId),
    index('domain_events_owner_id_idx').on(table.ownerId, table.id),
    index('domain_events_owner_thread_id_idx').on(table.ownerId, table.threadId, table.id),
  ],
)

export const schema = {
  owner,
  passkeyCredential,
  localEnrollmentTicket,
  remoteDevice,
  ownerSession,
  project,
  credential,
  domainEvent,
}
