/**
 * JSONL transcript backfill — imports `~/.claude/projects/<slug>/*.jsonl` into
 * the SQLite message/parts tables so users who flip to SQLite still see their
 * conversation history.
 *
 * Design notes:
 *   - Originals are NEVER modified. We only read.
 *   - Each transcript line is one event (user/assistant/tool/progress/...).
 *     We map user/assistant/tool rows to the `messages` table; tool_use and
 *     tool_result parts land in `parts`. Progress/meta rows are skipped.
 *   - Dedup: a `_migrations` row (kind='jsonl', file_path, sha256) tracks
 *     already-processed files. Re-runs are cheap no-ops.
 *   - Per-session dedup: if a session already has messages we skip that
 *     JSONL (covers the case where a user manually seeded a session).
 *   - Idempotent: safe to re-run. Malformed lines are counted + skipped,
 *     truncated trailing lines are tolerated.
 */
import { createHash } from 'crypto'
import { createReadStream, existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { sql } from 'drizzle-orm'

import {
  appendMessage,
  countSessions,
  createSession,
  loadSession,
  newId,
} from './api.js'
import { getDb } from './db.js'
import { messages } from './schema.sql.js'
import { eq } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type BackfillOpts = {
  /** Override default `~/.claude/projects`. */
  projectsDir?: string
  /** Force re-processing of files already recorded in `_migrations`. */
  force?: boolean
  /** Progress callback: (file-count-done, total, current-file). */
  onProgress?: (n: number, total: number, file: string) => void
  /** Cap recursion depth. Default 6 (covers subagents/ subdir). */
  maxDepth?: number
}

export type BackfillResult = {
  ran: boolean
  reason?: 'no-source' | 'no-transcripts'
  /** Number of JSONL files processed this run (imported OR already-processed). */
  filesScanned: number
  /** Number of JSONL files that produced new data. */
  filesImported: number
  /** Number of files skipped due to prior `_migrations` entry. */
  filesSkipped: number
  /** Total messages written across all files this run. */
  messagesImported: number
  /** Total sessions created this run (does not count pre-existing sessions). */
  sessionsCreated: number
  errors: Array<{ file: string; error: string }>
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export function getDefaultProjectsDir(): string {
  return join(homedir(), '.claude', 'projects')
}

// ---------------------------------------------------------------------------
// JSONL parsing helpers
// ---------------------------------------------------------------------------
type RawLine = {
  type?: string
  message?: {
    role?: string
    content?: unknown
    usage?: unknown
    model?: string
  } | string
  sessionId?: string
  timestamp?: string
  uuid?: string
  cwd?: string
  gitBranch?: string
  version?: string
  toolUseResult?: unknown
  isSidechain?: boolean
}

function parseLineSafe(line: string): RawLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as RawLine
  } catch {
    return null
  }
}

function toEpochMs(ts: string | undefined): number {
  if (!ts) return Date.now()
  const n = Date.parse(ts)
  return Number.isFinite(n) ? n : Date.now()
}

/**
 * Convert a parsed JSONL row to a message-shaped object, or null to skip.
 * We keep this function synchronous + pure so it's trivial to unit-test.
 */
export function mapRowToMessage(row: RawLine): null | {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: unknown
  usage: unknown
  createdAt: number
  parts: Array<{ type: string; state: unknown }>
} {
  if (!row || typeof row !== 'object') return null
  const t = row.type
  if (t !== 'user' && t !== 'assistant' && t !== 'system') return null

  const msg = row.message
  if (!msg) return null

  const role = (typeof msg === 'object' && msg.role) || t
  if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') {
    return null
  }

  const content = typeof msg === 'object' ? msg.content : msg
  const usage = typeof msg === 'object' ? (msg as { usage?: unknown }).usage ?? null : null
  const createdAt = toEpochMs(row.timestamp)

  // Derive parts: if content is an array, split tool_use / tool_result / text /
  // thinking entries into part rows. Non-array content stays flat in the
  // message.content blob.
  const parts: Array<{ type: string; state: unknown }> = []
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object' && typeof (c as { type?: string }).type === 'string') {
        parts.push({ type: (c as { type: string }).type, state: c })
      }
    }
  }

  return {
    role: role as 'user' | 'assistant' | 'tool' | 'system',
    content,
    usage,
    createdAt,
    parts,
  }
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------
async function findJsonlFiles(
  root: string,
  maxDepth: number,
  depth = 0,
  acc: string[] = [],
): Promise<string[]> {
  if (depth > maxDepth) return acc
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const ent of entries) {
    const full = join(root, ent.name)
    if (ent.isDirectory()) {
      await findJsonlFiles(full, maxDepth, depth + 1, acc)
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      acc.push(full)
    }
  }
  return acc
}

// ---------------------------------------------------------------------------
// sha256 helper — streamed so huge transcripts don't blow up memory.
// ---------------------------------------------------------------------------
async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('data', (d) => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// _migrations table helpers
// ---------------------------------------------------------------------------
async function hasBeenMigrated(
  filePath: string,
  sha: string,
): Promise<boolean> {
  const db = await getDb()
  const rows = (await db.all(
    sql`SELECT id FROM _migrations WHERE kind = 'jsonl' AND file_path = ${filePath} AND sha256 = ${sha} LIMIT 1`,
  )) as Array<{ id: string }>
  return rows.length > 0
}

async function recordMigration(params: {
  filePath: string
  sha: string
  sessionId: string | null
  messagesImported: number
}): Promise<void> {
  const db = await getDb()
  await db.run(
    sql`INSERT INTO _migrations (id, kind, file_path, sha256, session_id, messages_imported, ran_at)
        VALUES (${newId()}, 'jsonl', ${params.filePath}, ${params.sha}, ${params.sessionId}, ${params.messagesImported}, ${Date.now()})`,
  )
}

async function sessionHasMessages(sessionId: string): Promise<boolean> {
  const db = await getDb()
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .limit(1)
    .all()
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Line-by-line reader — tolerant of truncated final line.
// ---------------------------------------------------------------------------
async function* readLines(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) yield line
  } finally {
    rl.close()
    stream.destroy()
  }
}

// ---------------------------------------------------------------------------
// Per-file processor
// ---------------------------------------------------------------------------
async function processJsonlFile(
  filePath: string,
  force: boolean,
): Promise<{
  imported: boolean
  messagesImported: number
  sessionsCreated: number
  error?: string
}> {
  let sha: string
  try {
    sha = await sha256File(filePath)
  } catch (err) {
    return {
      imported: false,
      messagesImported: 0,
      sessionsCreated: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  if (!force && (await hasBeenMigrated(filePath, sha))) {
    return { imported: false, messagesImported: 0, sessionsCreated: 0 }
  }

  // Buffer messages per sessionId so we can create sessions lazily (first
  // seen id wins for metadata) and dedup on pre-existing content.
  type Buffered = {
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: unknown
    usage: unknown
    createdAt: number
    parts: Array<{ type: string; state: unknown }>
  }
  const bySession = new Map<
    string,
    { cwd?: string; gitBranch?: string; rows: Buffered[] }
  >()
  // Fallback session ID if a row lacks sessionId — derive from filename.
  const fallbackSessionId = filePath
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-40)

  try {
    for await (const raw of readLines(filePath)) {
      const row = parseLineSafe(raw)
      if (!row) continue
      const sid = row.sessionId || fallbackSessionId
      const mapped = mapRowToMessage(row)
      if (!mapped) continue
      let bucket = bySession.get(sid)
      if (!bucket) {
        bucket = { cwd: row.cwd, gitBranch: row.gitBranch, rows: [] }
        bySession.set(sid, bucket)
      }
      bucket.rows.push(mapped)
    }
  } catch (err) {
    return {
      imported: false,
      messagesImported: 0,
      sessionsCreated: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  let messagesImported = 0
  let sessionsCreated = 0
  let targetSessionId: string | null = null

  for (const [sid, bucket] of bySession.entries()) {
    // Skip if a session with this id already has messages — don't clobber.
    const existing = await loadSession(sid)
    if (existing && (await sessionHasMessages(sid))) continue

    if (!existing) {
      await createSession({
        id: sid,
        title: sid.slice(0, 12),
        projectId: bucket.cwd ?? '',
      })
      sessionsCreated++
    }

    // Sort rows by createdAt before inserting so out-of-order lines become
    // chronologically-ordered messages. Ties broken by original position.
    const ordered = [...bucket.rows]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        if (a.r.createdAt === b.r.createdAt) return a.i - b.i
        return a.r.createdAt - b.r.createdAt
      })
      .map(({ r }) => r)

    for (const r of ordered) {
      await appendMessage({
        sessionId: sid,
        role: r.role,
        content: r.content,
        usage: r.usage,
        createdAt: r.createdAt,
        parts: r.parts,
      })
      messagesImported++
    }
    targetSessionId = sid
  }

  await recordMigration({
    filePath,
    sha,
    sessionId: targetSessionId,
    messagesImported,
  })

  return {
    imported: messagesImported > 0 || sessionsCreated > 0,
    messagesImported,
    sessionsCreated,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function backfillFromJsonl(
  opts: BackfillOpts = {},
): Promise<BackfillResult> {
  const root = opts.projectsDir ?? getDefaultProjectsDir()
  const result: BackfillResult = {
    ran: false,
    filesScanned: 0,
    filesImported: 0,
    filesSkipped: 0,
    messagesImported: 0,
    sessionsCreated: 0,
    errors: [],
  }

  if (!existsSync(root)) {
    result.reason = 'no-source'
    return result
  }

  const files = await findJsonlFiles(root, opts.maxDepth ?? 6)
  if (files.length === 0) {
    result.reason = 'no-transcripts'
    return result
  }

  result.ran = true
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!
    opts.onProgress?.(i + 1, files.length, f)
    try {
      const r = await processJsonlFile(f, opts.force === true)
      result.filesScanned++
      if (r.error) {
        result.errors.push({ file: f, error: r.error })
        continue
      }
      if (r.imported) {
        result.filesImported++
        result.messagesImported += r.messagesImported
        result.sessionsCreated += r.sessionsCreated
      } else {
        result.filesSkipped++
      }
    } catch (err) {
      result.errors.push({
        file: f,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/**
 * Ora-wrapped flavor for CLI boot. Mirrors migrateWithSpinner in migrator.ts.
 */
export async function backfillWithSpinner(
  opts: BackfillOpts = {},
): Promise<BackfillResult> {
  let oraMod: { default: (cfg: unknown) => { start: () => { text: string; succeed: (s: string) => void; info: (s: string) => void; fail: (s: string) => void } } } | null = null
  try {
    oraMod = (await import('ora')) as unknown as typeof oraMod
  } catch {
    return backfillFromJsonl(opts)
  }
  const spinner = oraMod!.default({ text: 'Backfilling session transcripts…' }).start()
  try {
    const res = await backfillFromJsonl({
      ...opts,
      onProgress(n, total, file) {
        spinner.text = `Backfilling transcripts… ${n}/${total} (${file.split('/').slice(-2).join('/')})`
        opts.onProgress?.(n, total, file)
      },
    })
    if (!res.ran) {
      spinner.info(
        res.reason === 'no-source'
          ? 'No ~/.claude/projects/ — skipping transcript backfill'
          : 'No transcripts found to backfill',
      )
    } else if (res.filesImported === 0) {
      spinner.info(
        `Transcripts already up to date (${res.filesScanned} scanned, ${res.filesSkipped} skipped)`,
      )
    } else {
      spinner.succeed(
        `Imported ${res.sessionsCreated} sessions / ${res.messagesImported} messages from ${res.filesImported} transcripts`,
      )
    }
    return res
  } catch (err) {
    spinner.fail(
      `Transcript backfill failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    throw err
  }
}

/**
 * Has-backfill-run check — used by boot to short-circuit the spinner when
 * every transcript is already in `_migrations`. Returns false when there's
 * at least one new/unseen JSONL file.
 */
export async function isBackfillComplete(
  opts: { projectsDir?: string; maxDepth?: number } = {},
): Promise<boolean> {
  const root = opts.projectsDir ?? getDefaultProjectsDir()
  if (!existsSync(root)) return true
  const files = await findJsonlFiles(root, opts.maxDepth ?? 6)
  if (files.length === 0) return true
  for (const f of files) {
    let sha: string
    try {
      sha = await sha256File(f)
    } catch {
      continue
    }
    if (!(await hasBeenMigrated(f, sha))) return false
  }
  return true
}

// Re-export for convenience — enables `import { backfillFromJsonl } from '../services/session'`.
// (Also added to index.ts; kept here for local-module imports in tests.)
export { sha256File as _sha256FileForTest }
// Unused-guard to avoid tree-shake warnings
void stat
