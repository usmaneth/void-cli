/**
 * Read-flip tests — verifies the compat adapter routes reads through SQLite
 * when (a) the feature flag is set and (b) the DB has at least one session.
 * Confirms the fallback behavior when the DB is empty so pre-backfill users
 * still see their legacy JSON sessions.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

import {
  createSession,
  getDb,
  resetDbForTesting,
} from '../index.js'
import {
  listSessionsCompat,
  loadSessionCompat,
  resumeSessionCompat,
  resetAdapterCacheForTesting,
  shouldReadFromSqlite,
} from '../adapter.js'

const ORIG = process.env.VOID_USE_SQLITE_SESSIONS

beforeEach(async () => {
  resetDbForTesting()
  resetAdapterCacheForTesting()
  await getDb(':memory:')
})

afterEach(() => {
  if (ORIG === undefined) delete process.env.VOID_USE_SQLITE_SESSIONS
  else process.env.VOID_USE_SQLITE_SESSIONS = ORIG
})

describe('shouldReadFromSqlite', () => {
  it('is false when flag is unset', async () => {
    delete process.env.VOID_USE_SQLITE_SESSIONS
    expect(await shouldReadFromSqlite()).toBe(false)
  })

  it('is false when flag is set but DB is empty', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    expect(await shouldReadFromSqlite()).toBe(false)
  })

  it('is true when flag is set and DB has sessions', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    await createSession({ id: 's1', title: 't' })
    expect(await shouldReadFromSqlite()).toBe(true)
  })

  it('accepts true/yes variants of the flag', async () => {
    await createSession({ id: 's1', title: 't' })
    process.env.VOID_USE_SQLITE_SESSIONS = 'true'
    resetAdapterCacheForTesting()
    expect(await shouldReadFromSqlite()).toBe(true)
    process.env.VOID_USE_SQLITE_SESSIONS = 'yes'
    resetAdapterCacheForTesting()
    expect(await shouldReadFromSqlite()).toBe(true)
    process.env.VOID_USE_SQLITE_SESSIONS = '0'
    resetAdapterCacheForTesting()
    expect(await shouldReadFromSqlite()).toBe(false)
  })
})

describe('listSessionsCompat', () => {
  it('returns null when flag is off', async () => {
    delete process.env.VOID_USE_SQLITE_SESSIONS
    expect(await listSessionsCompat()).toBeNull()
  })

  it('returns LegacySessionInfo[] when flag is on', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    await createSession({
      id: 's1',
      title: 'Hello',
      projectId: '/tmp/proj',
      summary: 'the summary',
    })
    const out = await listSessionsCompat()
    expect(out).not.toBeNull()
    expect(out).toHaveLength(1)
    const info = out![0]!
    expect(info.sessionId).toBe('s1')
    expect(info.customTitle).toBe('Hello')
    expect(info.cwd).toBe('/tmp/proj')
    expect(info.summary).toBe('the summary')
    expect(typeof info.lastModified).toBe('number')
    expect(typeof info.createdAt).toBe('number')
  })

  it('applies projectId filter via the dir field', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    await createSession({ id: 's1', title: 'a', projectId: '/x' })
    await createSession({ id: 's2', title: 'b', projectId: '/y' })
    const out = await listSessionsCompat({ dir: '/x' })
    expect(out!.map((i) => i.sessionId)).toEqual(['s1'])
  })
})

describe('loadSessionCompat', () => {
  it('returns null when flag is off', async () => {
    delete process.env.VOID_USE_SQLITE_SESSIONS
    expect(await loadSessionCompat('s1')).toBeNull()
  })

  it('returns legacy info for known session', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    await createSession({ id: 's1', title: 'X' })
    const info = await loadSessionCompat('s1')
    expect(info?.sessionId).toBe('s1')
  })

  it('returns null for unknown session id', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    const info = await loadSessionCompat('missing')
    expect(info).toBeNull()
  })
})

describe('resumeSessionCompat', () => {
  it('returns null when flag is off', async () => {
    delete process.env.VOID_USE_SQLITE_SESSIONS
    expect(await resumeSessionCompat('s1')).toBeNull()
  })

  it('returns null for unknown session', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    expect(await resumeSessionCompat('nope')).toBeNull()
  })

  it('returns session + messages shape', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    const { appendMessage } = await import('../index.js')
    await createSession({ id: 's1', title: 't' })
    await appendMessage({
      sessionId: 's1',
      role: 'user',
      content: 'hi',
    })
    const out = await resumeSessionCompat('s1')
    expect(out?.info.sessionId).toBe('s1')
    expect(out?.messages).toHaveLength(1)
    expect(out?.messages[0]!.role).toBe('user')
  })
})

describe('Read-flip parity — SessionInfo shape', () => {
  it('matches the shape that legacy callers expect', async () => {
    process.env.VOID_USE_SQLITE_SESSIONS = '1'
    await createSession({
      id: 'sess-parity',
      title: 'Parity',
      projectId: '/a/b',
      summary: 'sum',
    })
    const rows = (await listSessionsCompat())!
    const info = rows[0]!
    // Every key expected to exist (even if undefined)
    expect(Object.keys(info).sort()).toEqual(
      ['sessionId', 'summary', 'lastModified', 'customTitle', 'cwd', 'createdAt'].sort(),
    )
    // lastModified is a number (ms since epoch)
    expect(Number.isFinite(info.lastModified)).toBe(true)
  })
})
