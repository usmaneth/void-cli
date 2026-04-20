/**
 * Session API — create / append / load / list / resume / fork / revert / search.
 *
 * All public functions return plain objects (not drizzle rows) so callers
 * can migrate off SQLite later without breaking consumers. ULID generation
 * is centralized in `newId()` so tests can inject a deterministic clock.
 */
import { and, asc, desc, eq, gt, isNull, like, or, sql } from 'drizzle-orm'
import { monotonicFactory } from 'ulid'

import { getDb, isFtsAvailable } from './db.js'
import { messages, parts, sessions } from './schema.sql.js'

const ulid = monotonicFactory()
export function newId(): string {
  return ulid()
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type Session = {
  id: string
  slug: string
  title: string
  projectId: string
  parentId: string | null
  parentMessageId: string | null
  createdAt: number
  updatedAt: number
  status: 'active' | 'archived'
  summary: string
}

export type Message = {
  id: string
  sessionId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  providerMetadata: unknown
  usage: unknown
  createdAt: number
  revertedAt: number | null
}

export type Part = {
  id: string
  messageId: string
  type: string
  state: unknown
  errorJson: unknown
  createdAt: number
}

// ---------------------------------------------------------------------------
// Row mappers — drizzle's JSON mode returns the parsed value already,
// so these are mostly shape-normalizers.
// ---------------------------------------------------------------------------
function toSession(row: any): Session {
  return {
    id: row.id,
    slug: row.slug ?? '',
    title: row.title ?? '',
    projectId: row.projectId ?? row.project_id ?? '',
    parentId: row.parentId ?? row.parent_id ?? null,
    parentMessageId:
      row.parentMessageId ?? row.parent_message_id ?? null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
    status: row.status ?? 'active',
    summary: row.summary ?? '',
  }
}

function toMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.sessionId ?? row.session_id,
    role: row.role,
    content: row.content,
    providerMetadata: row.providerMetadata ?? row.provider_metadata ?? null,
    usage: row.usage ?? null,
    createdAt: row.createdAt ?? row.created_at,
    revertedAt: row.revertedAt ?? row.reverted_at ?? null,
  }
}

function toPart(row: any): Part {
  return {
    id: row.id,
    messageId: row.messageId ?? row.message_id,
    type: row.type,
    state: row.state ?? null,
    errorJson: row.errorJson ?? row.error_json ?? null,
    createdAt: row.createdAt ?? row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------
export type CreateSessionInput = {
  id?: string
  title?: string
  slug?: string
  projectId?: string
  parentId?: string | null
  parentMessageId?: string | null
  summary?: string
}

export async function createSession(
  input: CreateSessionInput = {},
): Promise<Session> {
  const db = await getDb()
  const now = Date.now()
  const row = {
    id: input.id ?? newId(),
    slug: input.slug ?? '',
    title: input.title ?? '',
    projectId: input.projectId ?? '',
    parentId: input.parentId ?? null,
    parentMessageId: input.parentMessageId ?? null,
    createdAt: now,
    updatedAt: now,
    status: 'active' as const,
    summary: input.summary ?? '',
  }
  await db.insert(sessions).values(row).run()
  return toSession(row)
}

export async function updateSession(
  id: string,
  patch: Partial<
    Pick<Session, 'title' | 'slug' | 'summary' | 'status' | 'projectId'>
  >,
): Promise<void> {
  const db = await getDb()
  await db
    .update(sessions)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(sessions.id, id))
    .run()
}

// ---------------------------------------------------------------------------
// Load / list / resume
// ---------------------------------------------------------------------------
export async function loadSession(id: string): Promise<Session | null> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .all()
  if (!rows.length) return null
  return toSession(rows[0])
}

export type ListSessionsOpts = {
  projectId?: string
  parentId?: string | null
  limit?: number
  offset?: number
  includeArchived?: boolean
}

export async function listSessions(
  opts: ListSessionsOpts = {},
): Promise<Session[]> {
  const db = await getDb()
  const conds: any[] = []
  if (opts.projectId !== undefined)
    conds.push(eq(sessions.projectId, opts.projectId))
  if (opts.parentId !== undefined) {
    conds.push(
      opts.parentId === null
        ? isNull(sessions.parentId)
        : eq(sessions.parentId, opts.parentId),
    )
  }
  if (!opts.includeArchived) conds.push(eq(sessions.status, 'active'))

  const q = db
    .select()
    .from(sessions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sessions.updatedAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
  const rows = await q.all()
  return rows.map(toSession)
}

/**
 * Resume is a load-with-messages helper — returns the session plus
 * non-reverted messages in chronological order.
 */
export async function resumeSession(id: string): Promise<{
  session: Session
  messages: Message[]
} | null> {
  const session = await loadSession(id)
  if (!session) return null
  const db = await getDb()
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, id), isNull(messages.revertedAt)))
    .orderBy(asc(messages.createdAt))
    .all()
  return { session, messages: rows.map(toMessage) }
}

// ---------------------------------------------------------------------------
// Append message + parts
// ---------------------------------------------------------------------------
export type AppendMessageInput = {
  id?: string
  sessionId: string
  role: Message['role']
  content: unknown
  providerMetadata?: unknown
  usage?: unknown
  createdAt?: number
  parts?: Array<{
    id?: string
    type: string
    state?: unknown
    errorJson?: unknown
    createdAt?: number
  }>
}

export async function appendMessage(
  input: AppendMessageInput,
): Promise<Message> {
  const db = await getDb()
  const now = input.createdAt ?? Date.now()
  const msgRow = {
    id: input.id ?? newId(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content as any,
    providerMetadata: (input.providerMetadata ?? null) as any,
    usage: (input.usage ?? null) as any,
    createdAt: now,
    revertedAt: null,
  }

  await db.insert(messages).values(msgRow).run()

  if (input.parts?.length) {
    const partRows = input.parts.map((p) => ({
      id: p.id ?? newId(),
      messageId: msgRow.id,
      type: p.type,
      state: (p.state ?? null) as any,
      errorJson: (p.errorJson ?? null) as any,
      createdAt: p.createdAt ?? now,
    }))
    await db.insert(parts).values(partRows).run()
  }

  await db
    .update(sessions)
    .set({ updatedAt: now })
    .where(eq(sessions.id, input.sessionId))
    .run()

  return toMessage(msgRow)
}

export async function listMessageParts(messageId: string): Promise<Part[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(parts)
    .where(eq(parts.messageId, messageId))
    .orderBy(asc(parts.createdAt))
    .all()
  return rows.map(toPart)
}

// ---------------------------------------------------------------------------
// Fork / revert
// ---------------------------------------------------------------------------
/**
 * forkSession — creates a new session whose parent is `sessionId` and whose
 * history is copied up to (and including) `fromMessageId`. The parent stays
 * untouched; both sessions can continue independently.
 *
 * Returns the new session. Throws if parent or message not found.
 */
export async function forkSession(
  sessionId: string,
  fromMessageId: string,
  opts: { title?: string } = {},
): Promise<Session> {
  const db = await getDb()
  const parent = await loadSession(sessionId)
  if (!parent) throw new Error(`forkSession: parent ${sessionId} not found`)

  const anchor = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.id, fromMessageId)))
    .all()
  if (!anchor.length)
    throw new Error(
      `forkSession: message ${fromMessageId} not in session ${sessionId}`,
    )

  const child = await createSession({
    title: opts.title ?? `${parent.title || parent.id} (fork)`,
    projectId: parent.projectId,
    parentId: parent.id,
    parentMessageId: fromMessageId,
  })

  // Copy messages up to and including the fork point (ordered by createdAt,
  // tie-broken by id). The child keeps the same ULIDs so we can still map
  // parts back to their origin via createdAt ordering; parts are copied
  // with new IDs referencing the new message IDs.
  const anchorCreated = (anchor[0] as any).createdAt ?? (anchor[0] as any).created_at
  const history = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        isNull(messages.revertedAt),
        // <= anchor.createdAt
        sql`${messages.createdAt} <= ${anchorCreated}`,
      ),
    )
    .orderBy(asc(messages.createdAt))
    .all()

  const idMap = new Map<string, string>()
  for (const row of history) {
    const m = toMessage(row)
    const newMsgId = newId()
    idMap.set(m.id, newMsgId)
    await db
      .insert(messages)
      .values({
        id: newMsgId,
        sessionId: child.id,
        role: m.role,
        content: m.content as any,
        providerMetadata: m.providerMetadata as any,
        usage: m.usage as any,
        createdAt: m.createdAt,
        revertedAt: null,
      })
      .run()

    const origParts = await db
      .select()
      .from(parts)
      .where(eq(parts.messageId, m.id))
      .all()
    for (const p of origParts) {
      const pp = toPart(p)
      await db
        .insert(parts)
        .values({
          id: newId(),
          messageId: newMsgId,
          type: pp.type,
          state: pp.state as any,
          errorJson: pp.errorJson as any,
          createdAt: pp.createdAt,
        })
        .run()
    }
  }

  return child
}

/**
 * revertSession — soft-deletes every message in `sessionId` whose createdAt
 * is strictly greater than `toMessageId`'s createdAt. Messages are kept on
 * disk (no DROP) so the revert is reversible — future work could surface
 * an un-revert UI.
 */
export async function revertSession(
  sessionId: string,
  toMessageId: string,
): Promise<{ revertedCount: number }> {
  const db = await getDb()
  const anchor = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.id, toMessageId)))
    .all()
  if (!anchor.length)
    throw new Error(
      `revertSession: message ${toMessageId} not in session ${sessionId}`,
    )
  const anchorCreated = (anchor[0] as any).createdAt ?? (anchor[0] as any).created_at

  const now = Date.now()
  const res = await db
    .update(messages)
    .set({ revertedAt: now })
    .where(
      and(
        eq(messages.sessionId, sessionId),
        gt(messages.createdAt, anchorCreated),
        isNull(messages.revertedAt),
      ),
    )
    .run()

  await db
    .update(sessions)
    .set({ updatedAt: now })
    .where(eq(sessions.id, sessionId))
    .run()

  // better-sqlite3's run() returns { changes }; bun:sqlite returns
  // { changes }. drizzle wraps both as RunResult. Normalize.
  const changes =
    (res as any)?.changes ??
    (res as any)?.[0]?.changes ??
    (res as any)?.rowsAffected ??
    0
  return { revertedCount: Number(changes) }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
export type SearchOpts = {
  query: string
  limit?: number
  projectId?: string
}

export async function searchSessions(opts: SearchOpts): Promise<Session[]> {
  const db = await getDb()
  const limit = opts.limit ?? 25
  const q = opts.query.trim()
  if (!q) return []

  // FTS5 path — escape double-quotes and wrap terms to keep things literal.
  if (isFtsAvailable()) {
    try {
      const escaped = q.replace(/"/g, '""')
      const ftsQuery = `"${escaped}"*`
      const rows = await db
        .all(
          sql`SELECT s.* FROM sessions s
              JOIN sessions_fts f ON f.session_id = s.id
              WHERE sessions_fts MATCH ${ftsQuery}
                ${opts.projectId ? sql`AND s.project_id = ${opts.projectId}` : sql``}
                AND s.status = 'active'
              ORDER BY bm25(sessions_fts) ASC
              LIMIT ${limit}`,
        )
      return (rows as any[]).map(toSession)
    } catch {
      // Fall through to LIKE
    }
  }

  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const conds = [
    eq(sessions.status, 'active'),
    or(like(sessions.title, pattern), like(sessions.summary, pattern)),
  ]
  if (opts.projectId) conds.push(eq(sessions.projectId, opts.projectId))
  const rows = await db
    .select()
    .from(sessions)
    .where(and(...conds))
    .orderBy(desc(sessions.updatedAt))
    .limit(limit)
    .all()
  return rows.map(toSession)
}

// ---------------------------------------------------------------------------
// Counts — used by migrator to decide whether to run
// ---------------------------------------------------------------------------
export async function countSessions(): Promise<number> {
  const db = await getDb()
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(sessions)
    .all()
  return Number((rows?.[0] as any)?.n ?? 0)
}
