/**
 * One-shot migrator — imports `~/.void/sessions/*.json` into SQLite.
 *
 * Non-destructive: after a successful run the source directory is RENAMED
 * to `sessions.migrated-<timestamp>/` so a rollback is one `mv` away. The
 * migrator only runs when the DB has zero sessions (idempotent safety).
 *
 * Void's JSON format is a session registry ({ pid, sessionId, cwd,
 * startedAt, status, updatedAt, … }) rather than full transcripts — the
 * richer transcripts live under ~/.claude/projects. We import the
 * registry rows as empty-message sessions so users still see their list;
 * a follow-up PR can backfill messages from the JSONL transcripts.
 */
import { existsSync, renameSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

import { countSessions, createSession } from './api.js'

export type VoidRegistryEntry = {
  pid?: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  kind?: string
  entrypoint?: string
  status?: string
  updatedAt?: number
  title?: string
  summary?: string
}

export function getDefaultSourceDir(): string {
  return join(homedir(), '.void', 'sessions')
}

export type MigrateOpts = {
  sourceDir?: string
  onProgress?: (n: number, total: number, file: string) => void
  /** Skip the idempotence check (tests only). */
  force?: boolean
  /** Rename on success. Default true. */
  renameOnSuccess?: boolean
}

export type MigrateResult = {
  ran: boolean
  reason?: 'no-source' | 'db-not-empty' | 'empty-source'
  imported: number
  skipped: number
  errors: Array<{ file: string; error: string }>
  renamedTo?: string
}

export async function migrateJsonToSqlite(
  opts: MigrateOpts = {},
): Promise<MigrateResult> {
  const source = opts.sourceDir ?? getDefaultSourceDir()
  const result: MigrateResult = { ran: false, imported: 0, skipped: 0, errors: [] }

  if (!existsSync(source)) {
    result.reason = 'no-source'
    return result
  }

  if (!opts.force) {
    const existing = await countSessions()
    if (existing > 0) {
      result.reason = 'db-not-empty'
      return result
    }
  }

  let entries: string[] = []
  try {
    entries = (await readdir(source)).filter((f) => f.endsWith('.json'))
  } catch {
    result.reason = 'no-source'
    return result
  }

  if (entries.length === 0) {
    result.reason = 'empty-source'
    return result
  }

  result.ran = true

  for (let i = 0; i < entries.length; i++) {
    const file = entries[i]
    const full = join(source, file)
    opts.onProgress?.(i + 1, entries.length, file)
    try {
      const raw = await readFile(full, 'utf8')
      const parsed = JSON.parse(raw) as VoidRegistryEntry
      const st = await stat(full)
      const createdAt =
        parsed.startedAt ?? st.birthtimeMs ?? st.ctimeMs ?? Date.now()
      await createSession({
        id: parsed.sessionId ?? file.replace(/\.json$/, ''),
        title: parsed.title ?? file.replace(/\.json$/, ''),
        slug: parsed.kind ?? '',
        projectId: parsed.cwd ?? '',
        summary: parsed.summary ?? '',
      })
      result.imported++
    } catch (err) {
      result.skipped++
      result.errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (opts.renameOnSuccess !== false && result.imported > 0) {
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '')
    const renamed = `${source}.migrated-${stamp}`
    try {
      renameSync(source, renamed)
      result.renamedTo = renamed
    } catch (err) {
      result.errors.push({
        file: source,
        error: `rename failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      })
    }
  }

  return result
}

/**
 * Convenience wrapper that wires up `ora` for a CLI progress spinner.
 * Kept separate so unit tests of `migrateJsonToSqlite` don't need to
 * mock the spinner.
 */
export async function migrateWithSpinner(
  opts: MigrateOpts = {},
): Promise<MigrateResult> {
  let oraMod: any
  try {
    oraMod = await import('ora')
  } catch {
    return migrateJsonToSqlite(opts)
  }
  const spinner = oraMod.default({ text: 'Migrating sessions…' }).start()
  try {
    const res = await migrateJsonToSqlite({
      ...opts,
      onProgress(n, total, file) {
        spinner.text = `Migrating sessions… ${n}/${total} (${file})`
        opts.onProgress?.(n, total, file)
      },
    })
    if (!res.ran) {
      spinner.info(
        res.reason === 'db-not-empty'
          ? 'SQLite DB already populated — skipping migration'
          : 'No legacy sessions to migrate',
      )
    } else {
      spinner.succeed(
        `Imported ${res.imported} session${res.imported === 1 ? '' : 's'}` +
          (res.renamedTo ? ` (backup: ${res.renamedTo})` : ''),
      )
    }
    return res
  } catch (err) {
    spinner.fail(
      `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    throw err
  }
}
