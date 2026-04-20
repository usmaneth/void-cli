import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'

import { countSessions, getDb, resetDbForTesting } from '../index.js'
import { migrateJsonToSqlite } from '../migrator.js'

function makeSourceDir(entries: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'void-mig-'))
  const sessionsDir = join(dir, 'sessions')
  mkdirSync(sessionsDir)
  for (const [name, body] of Object.entries(entries)) {
    writeFileSync(join(sessionsDir, name), JSON.stringify(body))
  }
  return sessionsDir
}

beforeEach(async () => {
  resetDbForTesting()
  await getDb(':memory:')
})

describe('migrateJsonToSqlite', () => {
  it('imports JSON registry files and renames source dir on success', async () => {
    const src = makeSourceDir({
      '123.json': {
        pid: 123,
        sessionId: 'sess-a',
        cwd: '/proj/a',
        startedAt: 1000,
        status: 'busy',
      },
      '456.json': {
        pid: 456,
        sessionId: 'sess-b',
        cwd: '/proj/b',
        startedAt: 2000,
        status: 'idle',
      },
    })

    const result = await migrateJsonToSqlite({ sourceDir: src })
    expect(result.ran).toBe(true)
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(await countSessions()).toBe(2)
    expect(existsSync(src)).toBe(false)
    expect(result.renamedTo).toBeTruthy()
    expect(existsSync(result.renamedTo!)).toBe(true)
  })

  it('is idempotent — second run skips when DB is not empty', async () => {
    const src = makeSourceDir({
      'x.json': { sessionId: 'x', startedAt: 1 },
    })
    await migrateJsonToSqlite({ sourceDir: src })
    const before = await countSessions()

    // Fresh source, but DB is now populated
    const src2 = makeSourceDir({
      'y.json': { sessionId: 'y', startedAt: 2 },
    })
    const result = await migrateJsonToSqlite({ sourceDir: src2 })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('db-not-empty')
    expect(await countSessions()).toBe(before)
  })

  it('reports no-source when directory is missing', async () => {
    const result = await migrateJsonToSqlite({
      sourceDir: '/nonexistent/void/sessions',
    })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('no-source')
  })

  it('skips malformed JSON and continues', async () => {
    const src = makeSourceDir({
      'good.json': { sessionId: 'good', startedAt: 1 },
    })
    writeFileSync(join(src, 'bad.json'), '{not-json')
    const result = await migrateJsonToSqlite({ sourceDir: src })
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errors.length).toBe(1)
  })

  it('honors renameOnSuccess=false for dry-run-style usage', async () => {
    const src = makeSourceDir({
      'x.json': { sessionId: 'x', startedAt: 1 },
    })
    const result = await migrateJsonToSqlite({
      sourceDir: src,
      renameOnSuccess: false,
    })
    expect(result.imported).toBe(1)
    expect(existsSync(src)).toBe(true)
    expect(readdirSync(src).length).toBe(1)
  })
})
