/**
 * DB bootstrap — lazy singleton that prefers bun:sqlite when running under
 * Bun and falls back to better-sqlite3 on Node. Runs schema migrations on
 * first access and wires up the FTS5 virtual table + triggers.
 *
 * Pattern mirrors opencode's `#db` import: a single module owns the handle
 * so tests can reset it via `resetDbForTesting()`.
 */
import { existsSync, mkdirSync } from 'fs'
import { homedir, platform } from 'os'
import { dirname, join } from 'path'
import { sql } from 'drizzle-orm'

import * as schema from './schema.sql.js'

// ---------------------------------------------------------------------------
// Location — XDG-compliant with platform fallbacks. See:
//   https://specifications.freedesktop.org/basedir-spec/latest/
// ---------------------------------------------------------------------------
export function getDefaultDbPath(): string {
  if (process.env.VOID_DB_PATH) return process.env.VOID_DB_PATH

  const xdg = process.env.XDG_DATA_HOME
  if (xdg && xdg.trim().length > 0) {
    return join(xdg, 'void-cli', 'void.db')
  }

  switch (platform()) {
    case 'darwin':
      return join(
        homedir(),
        'Library',
        'Application Support',
        'void-cli',
        'void.db',
      )
    case 'win32':
      return join(
        process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
        'void-cli',
        'void.db',
      )
    default:
      return join(homedir(), '.local', 'share', 'void-cli', 'void.db')
  }
}

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------
type DrizzleDb = {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
  delete: (...args: any[]) => any
  run: (q: any) => any
  all: (q: any) => any
  transaction: <T>(fn: (tx: any) => T) => T
  $client: any
}

let _db: DrizzleDb | null = null
let _dbPath: string | null = null

function isBun(): boolean {
  // @ts-ignore Bun global is only defined under Bun runtime.
  return typeof globalThis.Bun !== 'undefined'
}

async function openBunDb(path: string): Promise<DrizzleDb> {
  // @ts-ignore bun:sqlite is only resolvable under Bun.
  const { Database } = await import('bun:sqlite')
  const { drizzle } = await import('drizzle-orm/bun-sqlite')
  const client = new Database(path, { create: true })
  client.exec('PRAGMA journal_mode = WAL;')
  client.exec('PRAGMA foreign_keys = ON;')
  return drizzle(client, { schema }) as unknown as DrizzleDb
}

async function openNodeDb(path: string): Promise<DrizzleDb> {
  const BetterSqlite3 = (await import('better-sqlite3')).default
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const client = new BetterSqlite3(path)
  client.pragma('journal_mode = WAL')
  client.pragma('foreign_keys = ON')
  return drizzle(client, { schema }) as unknown as DrizzleDb
}

// ---------------------------------------------------------------------------
// Schema bootstrap — tables are created by hand so the CLI has no extra
// install step. drizzle-kit is still used for generating reviewable
// migrations (see package.json scripts db:generate / db:migrate).
// ---------------------------------------------------------------------------
const DDL = [
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     slug TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '',
     project_id TEXT NOT NULL DEFAULT '',
     parent_id TEXT,
     parent_message_id TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'active',
     summary TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_parent_idx ON sessions(parent_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at)`,

  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     provider_metadata TEXT,
     usage TEXT,
     created_at INTEGER NOT NULL,
     reverted_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id)`,
  `CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(session_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS parts (
     id TEXT PRIMARY KEY,
     message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
     type TEXT NOT NULL,
     state TEXT,
     error_json TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS parts_message_idx ON parts(message_id)`,
]

// FTS5 virtual table + triggers. Kept separate because FTS5 is optional;
// if the SQLite build lacks it we silently fall back to LIKE search.
const FTS_DDL = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts
     USING fts5(
       session_id UNINDEXED,
       title,
       summary,
       tokenize = 'unicode61 remove_diacritics 2'
     )`,
  `CREATE TRIGGER IF NOT EXISTS sessions_fts_insert AFTER INSERT ON sessions BEGIN
     INSERT INTO sessions_fts(session_id, title, summary)
     VALUES (new.id, new.title, new.summary);
   END`,
  `CREATE TRIGGER IF NOT EXISTS sessions_fts_update AFTER UPDATE ON sessions BEGIN
     DELETE FROM sessions_fts WHERE session_id = old.id;
     INSERT INTO sessions_fts(session_id, title, summary)
     VALUES (new.id, new.title, new.summary);
   END`,
  `CREATE TRIGGER IF NOT EXISTS sessions_fts_delete AFTER DELETE ON sessions BEGIN
     DELETE FROM sessions_fts WHERE session_id = old.id;
   END`,
]

let _ftsAvailable = true
export function isFtsAvailable(): boolean {
  return _ftsAvailable
}

async function runBootstrap(db: DrizzleDb): Promise<void> {
  for (const stmt of DDL) {
    await db.run(sql.raw(stmt))
  }
  try {
    for (const stmt of FTS_DDL) {
      await db.run(sql.raw(stmt))
    }
    _ftsAvailable = true
  } catch {
    // SQLite built without FTS5 — searchSessions() will fall back to LIKE.
    _ftsAvailable = false
  }
}

export async function getDb(customPath?: string): Promise<DrizzleDb> {
  if (_db) return _db

  const path = customPath ?? getDefaultDbPath()
  _dbPath = path

  if (path !== ':memory:') {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  _db = isBun() ? await openBunDb(path) : await openNodeDb(path)
  await runBootstrap(_db)
  return _db
}

export function getDbPath(): string | null {
  return _dbPath
}

/** For tests — drops the singleton so a fresh DB (often :memory:) can be opened. */
export function resetDbForTesting(): void {
  try {
    // @ts-ignore close() exists on both better-sqlite3 and bun:sqlite clients.
    _db?.$client?.close?.()
  } catch {
    /* ignore */
  }
  _db = null
  _dbPath = null
  _ftsAvailable = true
}
