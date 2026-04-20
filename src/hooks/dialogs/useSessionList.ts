/**
 * Pure session-list helpers — Voidex / tests import these directly without
 * pulling in any Ink or React UI code.
 *
 * Data flow:
 *   loadSessionRows(store) -> SessionRow[]     (async, one-shot)
 *   rankSessions(rows, query) -> SessionRow[]  (sync, stateless)
 *   deleteSessionById(store, id) -> boolean    (pure sync wrapper)
 *
 * PR #58 is not yet merged into this branch — we depend on the existing
 * `SessionStore` from `src/sessions` and augment it with forked-from
 * detection by looking for a `parentId` tag on the session metadata.
 * When PR #58 lands, swap the loader for the new `sessionApi` client —
 * the SessionRow shape is already the public contract.
 */
import type { SessionMetadata, SessionStore } from '../../sessions/index.js'
import { fuzzyRank, type FuzzyMatch } from '../../utils/fuzzy/index.js'

export type SessionRow = {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly firstMessage: string
  readonly messageCount: number
  readonly lastActivity: number
  readonly parentId: string | null
  readonly cwd: string
  readonly branch: string | null
}

const PARENT_ID_TAG_PREFIX = 'parent:'

function extractParentId(meta: SessionMetadata): string | null {
  for (const tag of meta.tags) {
    if (tag.startsWith(PARENT_ID_TAG_PREFIX)) {
      return tag.slice(PARENT_ID_TAG_PREFIX.length) || null
    }
  }
  return null
}

export function toSessionRow(
  meta: SessionMetadata,
  firstMessage: string = '',
  summary: string = '',
): SessionRow {
  return {
    id: meta.id,
    title: meta.title,
    summary,
    firstMessage,
    messageCount: meta.messageCount,
    lastActivity: meta.updatedAt,
    parentId: extractParentId(meta),
    cwd: meta.cwd,
    branch: meta.branch ?? null,
  }
}

/**
 * Load all sessions from the store and materialize summary + first-message
 * previews. Each session has its messages loaded lazily (we only need the
 * first user message for search, so we stop after the first line hit).
 */
export function loadSessionRows(store: SessionStore): SessionRow[] {
  const metas = store.list()
  const out: SessionRow[] = []
  for (const meta of metas) {
    const loaded = store.load(meta.id)
    if (!loaded) {
      out.push(toSessionRow(meta))
      continue
    }
    const firstUser = loaded.messages.find(m => m.role === 'user')
    const firstMessage = firstUser ? firstUser.content.split('\n')[0] : ''
    // summary: first assistant message's first line (cheap proxy).
    const firstAsst = loaded.messages.find(m => m.role === 'assistant')
    const summary = firstAsst ? firstAsst.content.split('\n')[0].slice(0, 160) : ''
    out.push(toSessionRow(meta, firstMessage, summary))
  }
  return out
}

/**
 * Rank rows by a query. Empty query returns rows sorted by `lastActivity`
 * (most recent first), matching the user's intuition that a fresh list is
 * chronological.
 */
export function rankSessions(
  rows: readonly SessionRow[],
  query: string,
): FuzzyMatch<SessionRow>[] {
  const trimmed = query.trim()
  if (trimmed === '') {
    const sorted = [...rows].sort((a, b) => b.lastActivity - a.lastActivity)
    return sorted.map(row => ({ item: row, score: 0, indexes: [] }))
  }
  return fuzzyRank<SessionRow>(rows, trimmed, row => [
    row.title,
    row.summary,
    row.firstMessage,
  ])
}

/**
 * Delete a session by id. Thin wrapper around the store — kept here so
 * callers (including Voidex) don't need to construct a store instance
 * when all they have is the session id.
 */
export function deleteSessionById(store: SessionStore, id: string): boolean {
  return store.delete(id)
}

/**
 * Fork a session: create a new one whose metadata references the parent
 * via the `parent:<id>` tag. The actual message copy is delegated to the
 * caller (PR #58 exposes `forkSession(id)` which will replace this).
 *
 * We only tag the forked copy — the concrete copy-messages operation is
 * a SessionManager concern.
 */
export function makeForkTag(parentId: string): string {
  return `${PARENT_ID_TAG_PREFIX}${parentId}`
}

export function formatLastActivity(ts: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ts)
  const min = Math.floor(delta / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}mo ago`
  const year = Math.floor(month / 12)
  return `${year}y ago`
}
