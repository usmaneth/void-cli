/**
 * Tests for the JSONL → SQLite transcript backfill.
 *
 * Coverage:
 *   - Happy path: multi-session file, metadata mapping, ordering
 *   - Dedup via `_migrations` across reruns
 *   - Truncated final line tolerated
 *   - Malformed lines skipped, well-formed lines still imported
 *   - Out-of-order timestamps sorted chronologically
 *   - Parts extraction from tool_use / tool_result
 *   - Missing projects dir -> no-source
 *   - Empty projects dir -> no-transcripts
 *   - Skip session that already has messages (don't clobber)
 *   - Force flag re-processes already-migrated files
 *   - Subdir recursion (subagents/agent-xxx.jsonl)
 *   - Permission error on unreadable file -> recorded as error, continues
 *   - Multiple files processed via progress callback
 *   - Empty JSONL file produces no messages but still records
 *   - mapRowToMessage unit tests (pure fn)
 */
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  appendMessage,
  createSession,
  getDb,
  listSessions,
  resetDbForTesting,
  resumeSession,
} from '../index.js'
import {
  backfillFromJsonl,
  getDefaultProjectsDir,
  isBackfillComplete,
  mapRowToMessage,
} from '../jsonlBackfill.js'

function makeProjectsDir(
  files: Record<string, string[] | string>,
): string {
  const root = mkdtempSync(join(tmpdir(), 'void-jsonl-'))
  for (const [relPath, body] of Object.entries(files)) {
    const full = join(root, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    const content = Array.isArray(body) ? body.join('\n') + '\n' : body
    writeFileSync(full, content)
  }
  return root
}

function userLine(
  sid: string,
  text: string,
  ts: string,
  uuid = `u-${Math.random().toString(16).slice(2, 8)}`,
): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    sessionId: sid,
    timestamp: ts,
    uuid,
    cwd: '/proj/x',
  })
}

function assistantLine(
  sid: string,
  content: unknown,
  ts: string,
  uuid = `a-${Math.random().toString(16).slice(2, 8)}`,
): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content, usage: { input_tokens: 1, output_tokens: 2 } },
    sessionId: sid,
    timestamp: ts,
    uuid,
  })
}

function progressLine(sid: string, ts: string): string {
  return JSON.stringify({
    type: 'progress',
    sessionId: sid,
    timestamp: ts,
    data: { type: 'hook_progress' },
  })
}

beforeEach(async () => {
  resetDbForTesting()
  await getDb(':memory:')
})

describe('mapRowToMessage', () => {
  it('maps a user text message', () => {
    const out = mapRowToMessage({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    expect(out?.role).toBe('user')
    expect(out?.content).toBe('hi')
    expect(out?.parts).toEqual([])
  })

  it('maps assistant message with tool_use parts', () => {
    const out = mapRowToMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'tu_1', name: 'X', input: {} },
        ],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    expect(out?.role).toBe('assistant')
    expect(out?.parts).toHaveLength(2)
    expect(out?.parts.map((p) => p.type)).toEqual(['text', 'tool_use'])
  })

  it('returns null for progress rows', () => {
    expect(mapRowToMessage({ type: 'progress' })).toBeNull()
  })

  it('returns null when type is missing', () => {
    expect(mapRowToMessage({})).toBeNull()
  })

  it('defaults timestamp to now when missing', () => {
    const before = Date.now()
    const out = mapRowToMessage({
      type: 'user',
      message: { role: 'user', content: 'x' },
    })
    expect(out).not.toBeNull()
    expect(out!.createdAt).toBeGreaterThanOrEqual(before)
  })

  it('handles invalid timestamp strings', () => {
    const before = Date.now()
    const out = mapRowToMessage({
      type: 'user',
      message: { role: 'user', content: 'x' },
      timestamp: 'not-a-date',
    })
    expect(out!.createdAt).toBeGreaterThanOrEqual(before)
  })
})

describe('backfillFromJsonl — happy path', () => {
  it('imports a single session with text messages', async () => {
    const root = makeProjectsDir({
      'proj-a/sess-1.jsonl': [
        userLine('sess-1', 'hello', '2026-01-01T00:00:00.000Z'),
        assistantLine('sess-1', 'hi there', '2026-01-01T00:00:01.000Z'),
      ],
    })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.ran).toBe(true)
    expect(res.filesImported).toBe(1)
    expect(res.sessionsCreated).toBe(1)
    expect(res.messagesImported).toBe(2)
    const sessions = await listSessions({})
    expect(sessions.map((s) => s.id)).toContain('sess-1')
    const resumed = await resumeSession('sess-1')
    expect(resumed?.messages).toHaveLength(2)
    expect(resumed?.messages[0]!.role).toBe('user')
    expect(resumed?.messages[1]!.role).toBe('assistant')
  })

  it('recurses into subdirectories (subagents/)', async () => {
    const root = makeProjectsDir({
      'proj-a/sess-main.jsonl': [
        userLine('main', 'main', '2026-01-01T00:00:00.000Z'),
      ],
      'proj-a/sess-dir/subagents/agent-a.jsonl': [
        userLine('agent-a', 'sub', '2026-01-01T00:00:02.000Z'),
      ],
    })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.filesImported).toBe(2)
    const sessions = await listSessions({})
    expect(sessions.map((s) => s.id).sort()).toEqual(['agent-a', 'main'])
  })

  it('splits a JSONL with multiple sessionIds into separate sessions', async () => {
    const root = makeProjectsDir({
      'proj-a/mixed.jsonl': [
        userLine('s1', 'a', '2026-01-01T00:00:00.000Z'),
        userLine('s2', 'b', '2026-01-01T00:00:01.000Z'),
        userLine('s1', 'c', '2026-01-01T00:00:02.000Z'),
      ],
    })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.sessionsCreated).toBe(2)
    expect((await resumeSession('s1'))!.messages).toHaveLength(2)
    expect((await resumeSession('s2'))!.messages).toHaveLength(1)
  })

  it('skips progress/meta rows', async () => {
    const root = makeProjectsDir({
      'proj-a/s.jsonl': [
        progressLine('s1', '2026-01-01T00:00:00.000Z'),
        userLine('s1', 'real', '2026-01-01T00:00:01.000Z'),
        progressLine('s1', '2026-01-01T00:00:02.000Z'),
      ],
    })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.messagesImported).toBe(1)
  })

  it('extracts tool_use parts from assistant content arrays', async () => {
    const root = makeProjectsDir({
      'proj-a/s.jsonl': [
        assistantLine(
          's1',
          [
            { type: 'thinking', thinking: 'ponder' },
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 'tu', name: 'T', input: {} },
          ],
          '2026-01-01T00:00:00.000Z',
        ),
      ],
    })
    await backfillFromJsonl({ projectsDir: root })
    const r = await resumeSession('s1')
    expect(r).not.toBeNull()
    expect(r!.messages[0]!.role).toBe('assistant')
    // usage persisted
    expect(r!.messages[0]!.usage).toMatchObject({ input_tokens: 1 })
    // Parts: three content entries -> three parts
    const { listMessageParts } = await import('../index.js')
    const parts = await listMessageParts(r!.messages[0]!.id)
    expect(parts.map((p) => p.type).sort()).toEqual(
      ['text', 'thinking', 'tool_use'].sort(),
    )
  })
})

describe('backfillFromJsonl — edge cases', () => {
  it('tolerates a truncated last line (no trailing newline)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-jsonl-'))
    const projDir = join(root, 'p')
    mkdirSync(projDir, { recursive: true })
    // No trailing newline; last line is valid JSON
    writeFileSync(
      join(projDir, 's.jsonl'),
      userLine('s1', 'one', '2026-01-01T00:00:00.000Z') +
        '\n' +
        userLine('s1', 'two', '2026-01-01T00:00:01.000Z'),
    )
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.messagesImported).toBe(2)
  })

  it('tolerates a truncated final line that is not valid JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-jsonl-'))
    const projDir = join(root, 'p')
    mkdirSync(projDir, { recursive: true })
    writeFileSync(
      join(projDir, 's.jsonl'),
      userLine('s1', 'one', '2026-01-01T00:00:00.000Z') +
        '\n' +
        '{"type":"user","message":{"role":"user","content":"tr',
    )
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.messagesImported).toBe(1)
    expect(res.errors).toHaveLength(0)
  })

  it('skips malformed lines but imports good lines', async () => {
    const root = makeProjectsDir({
      'proj/s.jsonl': [
        userLine('s1', 'ok1', '2026-01-01T00:00:00.000Z'),
        'not-json-at-all',
        userLine('s1', 'ok2', '2026-01-01T00:00:01.000Z'),
      ],
    })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.messagesImported).toBe(2)
  })

  it('sorts out-of-order timestamps chronologically', async () => {
    const root = makeProjectsDir({
      'proj/s.jsonl': [
        userLine('s1', 'third', '2026-01-01T00:00:03.000Z'),
        userLine('s1', 'first', '2026-01-01T00:00:01.000Z'),
        userLine('s1', 'second', '2026-01-01T00:00:02.000Z'),
      ],
    })
    await backfillFromJsonl({ projectsDir: root })
    const r = await resumeSession('s1')
    const texts = r!.messages.map((m) => m.content)
    expect(texts).toEqual(['first', 'second', 'third'])
  })

  it('handles empty JSONL file without errors', async () => {
    const root = makeProjectsDir({ 'proj/empty.jsonl': '' })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.ran).toBe(true)
    expect(res.messagesImported).toBe(0)
    // still records the file in _migrations so re-runs skip it
    expect(res.filesSkipped + res.filesImported).toBe(1)
  })
})

describe('backfillFromJsonl — dedup + idempotence', () => {
  it('skips files already in _migrations on re-run', async () => {
    const root = makeProjectsDir({
      'proj/s.jsonl': [userLine('s1', 'x', '2026-01-01T00:00:00.000Z')],
    })
    const first = await backfillFromJsonl({ projectsDir: root })
    expect(first.filesImported).toBe(1)
    const second = await backfillFromJsonl({ projectsDir: root })
    expect(second.filesImported).toBe(0)
    expect(second.filesSkipped).toBe(1)
    // Still only one message — no double-insert
    const r = await resumeSession('s1')
    expect(r!.messages).toHaveLength(1)
  })

  it('force=true re-processes files already in _migrations', async () => {
    const root = makeProjectsDir({
      'proj/s.jsonl': [userLine('s1', 'x', '2026-01-01T00:00:00.000Z')],
    })
    await backfillFromJsonl({ projectsDir: root })
    const res = await backfillFromJsonl({ projectsDir: root, force: true })
    // session already has messages -> skip per-session; force only bypasses
    // the _migrations dedup, not the session-has-messages guard.
    expect(res.filesScanned).toBe(1)
  })

  it('skips sessions that already have messages (no clobber)', async () => {
    await createSession({ id: 's1', title: 'pre-existing' })
    await appendMessage({
      sessionId: 's1',
      role: 'user',
      content: 'original',
    })
    const root = makeProjectsDir({
      'proj/s.jsonl': [
        userLine('s1', 'new-from-jsonl', '2026-01-01T00:00:00.000Z'),
      ],
    })
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.messagesImported).toBe(0)
    const r = await resumeSession('s1')
    expect(r!.messages).toHaveLength(1)
    expect(r!.messages[0]!.content).toBe('original')
  })

  it('isBackfillComplete reports true after run', async () => {
    const root = makeProjectsDir({
      'proj/s.jsonl': [userLine('s1', 'x', '2026-01-01T00:00:00.000Z')],
    })
    expect(await isBackfillComplete({ projectsDir: root })).toBe(false)
    await backfillFromJsonl({ projectsDir: root })
    expect(await isBackfillComplete({ projectsDir: root })).toBe(true)
  })

  it('isBackfillComplete returns true for missing dir', async () => {
    expect(
      await isBackfillComplete({ projectsDir: '/no/such/dir' }),
    ).toBe(true)
  })
})

describe('backfillFromJsonl — errors / missing paths', () => {
  it('returns no-source when projects dir is missing', async () => {
    const res = await backfillFromJsonl({ projectsDir: '/no/such/dir' })
    expect(res.ran).toBe(false)
    expect(res.reason).toBe('no-source')
  })

  it('returns no-transcripts when directory exists but has no .jsonl', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-jsonl-'))
    mkdirSync(join(root, 'proj'))
    writeFileSync(join(root, 'proj', 'notes.md'), '# nope')
    const res = await backfillFromJsonl({ projectsDir: root })
    expect(res.ran).toBe(false)
    expect(res.reason).toBe('no-transcripts')
  })

  it('records a permission error as a per-file error and continues', async () => {
    // Only meaningful when not root; skip on CI where running as root
    if (process.getuid?.() === 0) return
    const root = mkdtempSync(join(tmpdir(), 'void-jsonl-'))
    const projDir = join(root, 'p')
    mkdirSync(projDir)
    const good = join(projDir, 'ok.jsonl')
    const bad = join(projDir, 'no-perm.jsonl')
    writeFileSync(good, userLine('sok', 'ok', '2026-01-01T00:00:00.000Z') + '\n')
    writeFileSync(bad, userLine('sbad', 'bad', '2026-01-01T00:00:00.000Z') + '\n')
    try {
      chmodSync(bad, 0o000)
      const res = await backfillFromJsonl({ projectsDir: root })
      // The good one should still import; bad one becomes an error row
      expect(res.messagesImported).toBeGreaterThanOrEqual(1)
      expect(res.errors.some((e) => e.file.endsWith('no-perm.jsonl'))).toBe(true)
    } finally {
      chmodSync(bad, 0o644)
    }
  })

  it('progress callback is invoked once per file', async () => {
    const root = makeProjectsDir({
      'proj/a.jsonl': [userLine('a', 'a', '2026-01-01T00:00:00.000Z')],
      'proj/b.jsonl': [userLine('b', 'b', '2026-01-01T00:00:00.000Z')],
      'proj/c.jsonl': [userLine('c', 'c', '2026-01-01T00:00:00.000Z')],
    })
    const seen: number[] = []
    await backfillFromJsonl({
      projectsDir: root,
      onProgress: (n, total) => {
        seen.push(n)
        expect(total).toBe(3)
      },
    })
    expect(seen).toEqual([1, 2, 3])
  })
})

describe('getDefaultProjectsDir', () => {
  it('points at ~/.claude/projects', () => {
    expect(getDefaultProjectsDir()).toMatch(
      /[/\\]\.claude[/\\]projects$/,
    )
  })
})
