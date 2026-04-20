/**
 * Drizzle-ORM schema for void-cli's SQLite session storage.
 *
 * Tables:
 *   - sessions  (one row per conversation; parentId enables fork/branch)
 *   - messages  (ordered within a session via createdAt + id ULID)
 *   - parts     (tool calls, tool results, text deltas — messageId FK)
 *
 * ULID IDs sort lexicographically by time, giving us cheap ordering without
 * a dedicated `seq` column.
 *
 * Soft-delete columns:
 *   - sessions.status  — 'active' | 'archived'
 *   - messages.revertedAt  — nullable epoch ms; revertSession() sets this.
 */
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // ULID
    slug: text('slug').notNull().default(''),
    title: text('title').notNull().default(''),
    projectId: text('project_id').notNull().default(''),
    parentId: text('parent_id'), // null = root
    parentMessageId: text('parent_message_id'), // fork point (null = new root)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    summary: text('summary').notNull().default(''),
  },
  (t) => ({
    projectIdx: index('sessions_project_idx').on(t.projectId),
    parentIdx: index('sessions_parent_idx').on(t.parentId),
    updatedIdx: index('sessions_updated_idx').on(t.updatedAt),
  }),
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(), // ULID
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['system', 'user', 'assistant', 'tool'],
    }).notNull(),
    content: text('content', { mode: 'json' }).notNull(), // JSON blob
    providerMetadata: text('provider_metadata', { mode: 'json' }),
    usage: text('usage', { mode: 'json' }),
    createdAt: integer('created_at').notNull(),
    revertedAt: integer('reverted_at'), // soft-delete marker
  },
  (t) => ({
    sessionIdx: index('messages_session_idx').on(t.sessionId),
    sessionCreatedIdx: index('messages_session_created_idx').on(
      t.sessionId,
      t.createdAt,
    ),
  }),
)

export const parts = sqliteTable(
  'parts',
  {
    id: text('id').primaryKey(), // ULID
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'text' | 'tool_use' | 'tool_result' | 'thinking' | ...
    state: text('state', { mode: 'json' }), // type-specific JSON
    errorJson: text('error_json', { mode: 'json' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    messageIdx: index('parts_message_idx').on(t.messageId),
  }),
)

// FTS5 virtual table is created in bootstrap.ts (drizzle doesn't model FTS5
// directly — we emit the CREATE VIRTUAL TABLE statement manually and keep
// it in sync via triggers).

export type SessionRow = typeof sessions.$inferSelect
export type SessionInsert = typeof sessions.$inferInsert
export type MessageRow = typeof messages.$inferSelect
export type MessageInsert = typeof messages.$inferInsert
export type PartRow = typeof parts.$inferSelect
export type PartInsert = typeof parts.$inferInsert
