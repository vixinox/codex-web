import { relations } from 'drizzle-orm/_relations'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const timestamp = (name: string) => integer(name, { mode: 'timestamp' })

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  currentCredentialId: text('current_credential_id'),
  createdAt: timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false).notNull(),
})

export const twoFactor = sqliteTable('twoFactor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  verified: integer('verified', { mode: 'boolean' }).default(true).notNull(),
  failedVerificationCount: integer('failed_verification_count').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const project = sqliteTable(
  'project',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
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
    index('project_userId_idx').on(table.userId),
    uniqueIndex('project_userId_name_unique').on(table.userId, table.name),
    uniqueIndex('project_userId_path_unique').on(table.userId, table.path),
  ],
)

export const credential = sqliteTable(
  'credential',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
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
  (table) => [index('credential_userId_idx').on(table.userId)],
)

export const codexEvent = sqliteTable(
  'codex_event',
  {
    id: integer('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    threadId: text('thread_id'),
    message: text('message', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('codex_event_user_id_idx').on(table.userId),
    index('codex_event_user_id_id_idx').on(table.userId, table.id),
    index('codex_event_user_id_thread_id_id_idx').on(table.userId, table.threadId, table.id),
  ],
)

export const ownerSecurityState = sqliteTable('owner_security_state', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  recoveryCodesAcknowledgedAt: timestamp('recovery_codes_acknowledged_at'),
})

export const schema = {
  user,
  twoFactor,
  session,
  account,
  verification,
  project,
  credential,
  codexEvent,
  ownerSecurityState,
}

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}))
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}))
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}))
export const projectRelations = relations(project, ({ one }) => ({
  user: one(user, { fields: [project.userId], references: [user.id] }),
}))
export const credentialRelations = relations(credential, ({ one }) => ({
  user: one(user, { fields: [credential.userId], references: [user.id] }),
}))
