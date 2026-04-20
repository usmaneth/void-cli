/**
 * Public entrypoint for void-cli's SQLite-backed session service.
 *
 * Callers should ideally import from here rather than reaching into
 * individual files — this gives us room to swap the backend later.
 */
export {
  getDb,
  getDbPath,
  getDefaultDbPath,
  isFtsAvailable,
  resetDbForTesting,
} from './db.js'

export {
  appendMessage,
  countSessions,
  createSession,
  forkSession,
  listMessageParts,
  listSessions,
  loadSession,
  newId,
  resumeSession,
  revertSession,
  searchSessions,
  updateSession,
} from './api.js'

export type {
  AppendMessageInput,
  CreateSessionInput,
  ListSessionsOpts,
  Message,
  Part,
  SearchOpts,
  Session,
} from './api.js'

export {
  getDefaultSourceDir,
  migrateJsonToSqlite,
  migrateWithSpinner,
} from './migrator.js'

export type { MigrateOpts, MigrateResult } from './migrator.js'

/** Feature-flag check used by adapters to route to SQLite or JSON. */
export function isSqliteSessionsEnabled(): boolean {
  const v = process.env.VOID_USE_SQLITE_SESSIONS
  return v === '1' || v === 'true' || v === 'yes'
}
