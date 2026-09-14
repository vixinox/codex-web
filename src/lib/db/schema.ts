import { relations } from 'drizzle-orm/_relations'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  integer,
  jsonb,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    kind: text('kind').default('owner').notNull(),
    isAnonymous: boolean('is_anonymous').default(false),
    currentCredentialId: text('current_credential_id').references(
      (): AnyPgColumn => credential.id,
      {
        onDelete: 'set null',
      },
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [check('user_kind_check', sql`${table.kind} in ('owner', 'guest', 'admin')`)],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('project_userId_idx').on(table.userId),
    uniqueIndex('project_userId_name_unique').on(table.userId, table.name),
    uniqueIndex('project_userId_path_unique').on(table.userId, table.path),
  ],
)

export const credential = pgTable(
  'credential',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    baseUrl: text('base_url').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('credential_userId_idx').on(table.userId)],
)

export const codexEvent = pgTable(
  'codex_event',
  {
    id: integer('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    threadId: text('thread_id'),
    message: jsonb('message').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('codex_event_user_id_idx').on(table.userId),
    index('codex_event_user_id_id_idx').on(table.userId, table.id),
    index('codex_event_user_id_thread_id_id_idx').on(table.userId, table.threadId, table.id),
  ],
)

export const guest = pgTable(
  'guest',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
      .unique(),
    leaseSecretHash: text('lease_secret_hash').unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('guest_user_id_idx').on(table.userId),
    index('guest_expires_at_idx').on(table.expiresAt),
    index('guest_deleted_at_idx').on(table.deletedAt),
  ],
)

export const guestThread = pgTable(
  'guest_thread',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id')
      .notNull()
      .references(() => guest.id, { onDelete: 'cascade' }),
    nativeThreadId: text('native_thread_id').notNull(),
    title: text('title').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('guest_thread_guest_id_idx').on(table.guestId),
    uniqueIndex('guest_thread_native_id_unique').on(table.nativeThreadId),
  ],
)

export const guestEvent = pgTable(
  'guest_event',
  {
    id: integer('id').primaryKey(),
    guestId: text('guest_id')
      .notNull()
      .references(() => guest.id, { onDelete: 'cascade' }),
    guestThreadId: text('guest_thread_id'),
    message: jsonb('message').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('guest_event_guest_id_idx').on(table.guestId),
    index('guest_event_thread_id_idx').on(table.guestThreadId, table.id),
  ],
)

export const guestTurnJob = pgTable(
  'guest_turn_job',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id')
      .notNull()
      .references(() => guest.id, { onDelete: 'cascade' }),
    guestThreadId: text('guest_thread_id')
      .notNull()
      .references(() => guestThread.id, { onDelete: 'cascade' }),
    nativeTurnId: text('native_turn_id'),
    inputText: text('input_text'),
    model: text('model'),
    reasoningEffort: text('reasoning_effort'),
    collaborationMode: text('collaboration_mode').notNull().default('plan'),
    skillHandles: jsonb('skill_handles').$type<string[]>().notNull().default([]),
    status: text('status').notNull(),
    usageDate: text('usage_date').notNull(),
    actualTokens: integer('actual_tokens').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('guest_turn_job_status_idx').on(table.status, table.createdAt),
    index('guest_turn_job_guest_idx').on(table.guestId, table.status),
  ],
)

export const guestDailyUsage = pgTable(
  'guest_daily_usage',
  {
    guestId: text('guest_id')
      .notNull()
      .references(() => guest.id, { onDelete: 'cascade' }),
    usageDate: text('usage_date').notNull(),
    usedTokens: integer('used_tokens').notNull().default(0),
  },
  (table) => [uniqueIndex('guest_daily_usage_unique').on(table.guestId, table.usageDate)],
)

export const guestGlobalDailyUsage = pgTable('guest_global_daily_usage', {
  usageDate: text('usage_date').primaryKey(),
  usedTokens: integer('used_tokens').notNull().default(0),
})

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const projectRelations = relations(project, ({ one }) => ({
  user: one(user, { fields: [project.userId], references: [user.id] }),
}))

export const credentialRelations = relations(credential, ({ one }) => ({
  user: one(user, { fields: [credential.userId], references: [user.id] }),
}))
