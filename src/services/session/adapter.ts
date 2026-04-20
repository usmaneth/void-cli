/**
 * Compatibility adapter — when `VOID_USE_SQLITE_SESSIONS=1`, this module
 * provides drop-in implementations of the legacy JSON session APIs so the
 * rest of the CLI can switch backends without signature changes.
 *
 * Only implements the narrow surface that's safe to reroute today; the
 * 5k-line `src/utils/sessionStorage.ts` still owns transcript-level
 * operations (JSONL read/write, resume chain reconstruction). Expand this
 * shim as individual JSON code paths are retired.
 */
import {
  countSessions,
  createSession,
  isSqliteSessionsEnabled,
  listSessions,
  loadSession,
  resumeSession,
  searchSessions,
  type Message,
  type Session,
} from './index.js'

/** Legacy SessionInfo shape from listSessionsImpl.ts — kept loose on purpose. */
export type LegacySessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  createdAt?: number
}

export function sessionToLegacyInfo(s: Session): LegacySessionInfo {
  return {
    sessionId: s.id,
    summary: s.summary,
    lastModified: s.updatedAt,
    customTitle: s.title || undefined,
    cwd: s.projectId || undefined,
    createdAt: s.createdAt,
  }
}

export type LegacyListOpts = {
  dir?: string
  limit?: number
  offset?: number
}

export async function listSessionsCompat(
  opts: LegacyListOpts = {},
): Promise<LegacySessionInfo[] | null> {
  if (!isSqliteSessionsEnabled()) return null
  const rows = await listSessions({
    projectId: opts.dir,
    limit: opts.limit,
    offset: opts.offset,
  })
  return rows.map(sessionToLegacyInfo)
}

export async function loadSessionCompat(
  id: string,
): Promise<LegacySessionInfo | null> {
  if (!isSqliteSessionsEnabled()) return null
  const s = await loadSession(id)
  return s ? sessionToLegacyInfo(s) : null
}

export async function searchSessionsCompat(
  query: string,
  limit = 25,
): Promise<LegacySessionInfo[] | null> {
  if (!isSqliteSessionsEnabled()) return null
  const rows = await searchSessions({ query, limit })
  return rows.map(sessionToLegacyInfo)
}

export async function createSessionCompat(params: {
  id?: string
  title?: string
  cwd?: string
  summary?: string
}): Promise<LegacySessionInfo | null> {
  if (!isSqliteSessionsEnabled()) return null
  const s = await createSession({
    id: params.id,
    title: params.title,
    projectId: params.cwd,
    summary: params.summary,
  })
  return sessionToLegacyInfo(s)
}

/**
 * resumeSessionCompat — mirrors `resumeSession` from the API but returns
 * legacy shapes. Returns null when the flag is off so the caller falls
 * through to the JSON path; returns { found: false } when the id isn't
 * in SQLite (caller can then try legacy as a fallback).
 */
export type ResumeCompatResult = {
  info: LegacySessionInfo
  messages: Message[]
}

export async function resumeSessionCompat(
  id: string,
): Promise<ResumeCompatResult | null> {
  if (!isSqliteSessionsEnabled()) return null
  const r = await resumeSession(id)
  if (!r) return null
  return { info: sessionToLegacyInfo(r.session), messages: r.messages }
}

/**
 * Guard used by the read-flip: "should we use SQLite right now?" SQLite is
 * only trusted once it has at least one session — callers fall back to
 * legacy JSON otherwise so pre-backfill users keep seeing their history.
 */
let _nonEmptyCache: boolean | null = null
export function resetAdapterCacheForTesting(): void {
  _nonEmptyCache = null
}

export async function shouldReadFromSqlite(): Promise<boolean> {
  if (!isSqliteSessionsEnabled()) return false
  if (_nonEmptyCache === true) return true
  try {
    const n = await countSessions()
    _nonEmptyCache = n > 0
    return _nonEmptyCache
  } catch {
    // DB access failed — never block the legacy path.
    return false
  }
}
