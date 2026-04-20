/**
 * Tests for auto session compaction + auto-generated summaries.
 *
 * Run via (after `npm run build`):
 *   node --test dist/sessions/__tests__/autoCompaction.test.js
 *
 * Uses the built-in node:test runner (Node >= 18). No external test deps.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SessionManager,
  SessionStore,
  type SessionMessage,
} from '../index.js'
import {
  AutoCompactionManager,
  DEFAULT_SETTINGS,
  __resetTokenizerForTests,
  countMessageTokens,
  countTokens,
  resolveSettings,
  type SummaryProvider,
} from '../autoCompaction.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempStore(): { store: SessionStore; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'void-ac-test-'))
  const store = new SessionStore(dir)
  return { store, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function seedSession(
  manager: SessionManager,
  count: number,
  contentLen = 400,
): SessionMessage[] {
  const out: SessionMessage[] = []
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    const content = `[msg${i}] ` + 'x'.repeat(contentLen)
    const m: SessionMessage = { role, content, timestamp: Date.now() + i }
    manager.recordMessage(m)
    out.push(m)
  }
  return out
}

function mockSummaryProvider(summary = 'Session title line\n\n- Did a thing'): SummaryProvider {
  return async () => summary
}

// ---------------------------------------------------------------------------
// 1. Token counter
// ---------------------------------------------------------------------------

test('countTokens returns 0 for empty string', () => {
  assert.equal(countTokens(''), 0)
})

test('countTokens uses chars/4 fallback when gpt-tokenizer is absent', () => {
  __resetTokenizerForTests()
  // chars/4 → Math.ceil(len/4). For "hello world" (11 chars) → 3.
  assert.equal(countTokens('hello world'), 3)
  assert.equal(countTokens('a'.repeat(4)), 1)
  assert.equal(countTokens('a'.repeat(5)), 2)
})

test('countMessageTokens sums content + tool calls', () => {
  __resetTokenizerForTests()
  const messages: SessionMessage[] = [
    { role: 'user', content: 'a'.repeat(8), timestamp: 0 },
    {
      role: 'assistant',
      content: 'b'.repeat(4),
      timestamp: 1,
      toolCalls: [{ name: 'Bash', result: 'c'.repeat(12) }],
    },
  ]
  // 8/4 + 4/4 + (4/4 + 12/4) = 2 + 1 + 1 + 3 = 7
  assert.equal(countMessageTokens(messages), 7)
})

// ---------------------------------------------------------------------------
// 2. Settings resolution
// ---------------------------------------------------------------------------

test('resolveSettings returns defaults when nothing given', () => {
  const s = resolveSettings(null, {})
  assert.deepEqual(s, DEFAULT_SETTINGS)
})

test('resolveSettings honours flat keys', () => {
  const s = resolveSettings(
    { auto: false, threshold: 1000, preserveRecent: 4, resummarizeEvery: 5 },
    {},
  )
  assert.equal(s.auto, false)
  assert.equal(s.threshold, 1000)
  assert.equal(s.preserveRecent, 4)
  assert.equal(s.resummarizeEvery, 5)
})

test('resolveSettings honours compaction.* dotted and nested keys', () => {
  const s = resolveSettings(
    {
      'compaction.auto': false,
      'compaction.threshold': 500,
      'compaction.preserveRecent': 2,
    },
    {},
  )
  assert.equal(s.auto, false)
  assert.equal(s.threshold, 500)
  assert.equal(s.preserveRecent, 2)

  const nested = resolveSettings(
    { compaction: { auto: false, threshold: 777, preserveRecent: 3 } },
    {},
  )
  assert.equal(nested.auto, false)
  assert.equal(nested.threshold, 777)
  assert.equal(nested.preserveRecent, 3)
})

test('VOID_AUTO_COMPACT env var overrides settings.auto', () => {
  assert.equal(resolveSettings({ auto: false }, { VOID_AUTO_COMPACT: '1' }).auto, true)
  assert.equal(resolveSettings({ auto: true }, { VOID_AUTO_COMPACT: '0' }).auto, false)
  // Unrelated env var → no effect.
  assert.equal(resolveSettings({ auto: true }, { VOID_AUTO_COMPACT: undefined }).auto, true)
})

test('resolveSettings ignores invalid values', () => {
  const s = resolveSettings({ threshold: -1, preserveRecent: 'nope' as unknown as number }, {})
  assert.equal(s.threshold, DEFAULT_SETTINGS.threshold)
  assert.equal(s.preserveRecent, DEFAULT_SETTINGS.preserveRecent)
})

// ---------------------------------------------------------------------------
// 3. Threshold trigger + preservation
// ---------------------------------------------------------------------------

test('maybeCompact is a no-op when below threshold', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 4, 40)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 1_000_000 },
      env: {},
    })
    const result = await acm.maybeCompact(manager)
    assert.equal(result.ran, false)
    assert.equal(result.reason, 'below-threshold')
    assert.equal(manager.getMessages().length, 4)
  } finally {
    cleanup()
  }
})

test('maybeCompact compacts when tokens exceed threshold', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    // 20 messages of ~400 chars each → ~2000 tokens (chars/4)
    seedSession(manager, 20, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 500, preserveRecent: 8 },
      env: {},
    })
    const result = await acm.maybeCompact(manager)
    assert.equal(result.ran, true)
    assert.equal(result.trigger, 'threshold')
    // After compaction: 1 summary + 8 preserved = 9
    assert.equal(manager.getMessages().length, 9)
    // Summary message is role=system and carries compactedAt marker
    const summaryMsg = manager.getMessages()[0]!
    assert.equal(summaryMsg.role, 'system')
    assert.ok(summaryMsg.compactedAt && summaryMsg.compactedAt > 0)
    // Session metadata has the summary persisted
    assert.ok(manager.currentSession?.summary)
    assert.ok(manager.currentSession?.compactedAt)
  } finally {
    cleanup()
  }
})

test('preservedRecent messages are kept verbatim after compaction', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    const originals = seedSession(manager, 12, 500)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    await acm.maybeCompact(manager)

    const after = manager.getMessages()
    const tail = after.slice(-4)
    const expectedTail = originals.slice(-4)
    for (let i = 0; i < 4; i++) {
      assert.equal(tail[i]!.content, expectedTail[i]!.content)
      assert.equal(tail[i]!.role, expectedTail[i]!.role)
    }
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 4. Provider mocking
// ---------------------------------------------------------------------------

test('provider is called with instructions + older messages', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 15, 400)

    let seenInstructions = ''
    let seenCount = 0
    const provider: SummaryProvider = async ({ instructions, messages }) => {
      seenInstructions = instructions
      seenCount = messages.length
      return 'Mock summary title\n\nBullet one'
    }
    const acm = new AutoCompactionManager({
      provider,
      settings: { threshold: 100, preserveRecent: 5 },
      env: {},
    })
    const result = await acm.maybeCompact(manager)
    assert.equal(result.ran, true)
    assert.match(seenInstructions, /preserves/i)
    // 15 messages - 5 preserved = 10 summarised
    assert.equal(seenCount, 10)
    assert.equal(result.summary, 'Mock summary title\n\nBullet one')
  } finally {
    cleanup()
  }
})

test('empty provider output aborts compaction', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 15, 400)

    const acm = new AutoCompactionManager({
      provider: async () => '',
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    const result = await acm.maybeCompact(manager)
    assert.equal(result.ran, false)
    assert.equal(result.reason, 'empty-summary')
    // Session unchanged.
    assert.equal(manager.getMessages().length, 15)
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 5. Mid-turn guard + VOID_AUTO_COMPACT flag
// ---------------------------------------------------------------------------

test('maybeCompact does not run mid-assistant-turn', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 20, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    acm.beginAssistantTurn()
    const blocked = await acm.maybeCompact(manager)
    assert.equal(blocked.ran, false)
    assert.equal(blocked.reason, 'mid-turn')
    acm.endAssistantTurn()
    const okAfter = await acm.maybeCompact(manager)
    assert.equal(okAfter.ran, true)
  } finally {
    cleanup()
  }
})

test('VOID_AUTO_COMPACT=0 disables auto-compaction', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 20, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 100 },
      env: { VOID_AUTO_COMPACT: '0' },
    })
    const blocked = await acm.maybeCompact(manager)
    assert.equal(blocked.ran, false)
    assert.equal(blocked.reason, 'auto-disabled')
    // force:true bypasses the disable.
    const forced = await acm.maybeCompact(manager, { force: true })
    assert.equal(forced.ran, true)
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 6. Idempotence + periodic re-summarise
// ---------------------------------------------------------------------------

test('second call without new messages is idempotent', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 20, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 100, preserveRecent: 4, resummarizeEvery: 20 },
      env: {},
    })
    await acm.maybeCompact(manager)
    const afterFirst = manager.getMessages().length

    const second = await acm.maybeCompact(manager)
    assert.equal(second.ran, false)
    assert.ok(
      second.reason === 'below-threshold' ||
        second.reason === 'nothing-new' ||
        second.reason === 'nothing-to-summarise',
    )
    assert.equal(manager.getMessages().length, afterFirst)
  } finally {
    cleanup()
  }
})

test('periodic re-summarise triggers after resummarizeEvery new messages', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 15, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider('First summary title\n\n- first'),
      settings: { threshold: 100, preserveRecent: 4, resummarizeEvery: 5 },
      env: {},
    })
    const first = await acm.maybeCompact(manager)
    assert.equal(first.ran, true)

    // Add 5 new messages — should NOT re-trigger via threshold (threshold=100
    // was met on the pre-compaction context, but after compaction tokens are
    // low). It should trigger via `periodic`.
    seedSession(manager, 5, 40)
    const acm2 = new AutoCompactionManager({
      provider: mockSummaryProvider('Second summary title\n\n- second'),
      settings: { threshold: 1_000_000, preserveRecent: 4, resummarizeEvery: 5 },
      env: {},
    })
    const second = await acm2.maybeCompact(manager)
    assert.equal(second.ran, true)
    assert.equal(second.trigger, 'periodic')
    assert.match(manager.currentSession!.summary!, /Second summary title/)
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 7. Session list title falls back to summary's first line
// ---------------------------------------------------------------------------

test('list() uses summary first line when user has not set a title', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    const meta = manager.startSession('/tmp')
    // Seed messages AFTER startSession; title will auto-populate from first user
    // message but titleUserSet stays false.
    seedSession(manager, 15, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider('My great debug session\n\n- stuff'),
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    await acm.maybeCompact(manager)

    const listed = store.list().find(s => s.id === meta.id)!
    assert.equal(listed.title, 'My great debug session')
  } finally {
    cleanup()
  }
})

test('list() keeps a user-set title even when a summary exists', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    const meta = manager.startSession('/tmp')
    seedSession(manager, 15, 400)
    manager.setTitle('Refactor the planner')

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider('Some auto summary line\n\n- stuff'),
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    await acm.maybeCompact(manager)
    const listed = store.list().find(s => s.id === meta.id)!
    assert.equal(listed.title, 'Refactor the planner')
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 8. /uncompact rollback
// ---------------------------------------------------------------------------

test('uncompact() restores pre-compaction messages', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    const originals = seedSession(manager, 15, 400)

    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider(),
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    await acm.maybeCompact(manager)
    assert.equal(manager.getMessages().length, 5) // 1 summary + 4 preserved

    const rolledBack = manager.uncompact()
    assert.equal(rolledBack, true)
    assert.equal(manager.getMessages().length, 15)
    for (let i = 0; i < 15; i++) {
      assert.equal(manager.getMessages()[i]!.content, originals[i]!.content)
    }
    assert.equal(manager.currentSession?.summary, undefined)
    assert.equal(manager.currentSession?.compactedAt, undefined)
  } finally {
    cleanup()
  }
})

test('uncompact() without a stash returns false', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 5, 100)
    assert.equal(manager.uncompact(), false)
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 9. Compaction persists to disk and survives reload
// ---------------------------------------------------------------------------

test('compaction result is persisted and reloadable', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    const meta = manager.startSession('/tmp')
    seedSession(manager, 15, 400)
    const acm = new AutoCompactionManager({
      provider: mockSummaryProvider('Persisted summary line\n\n- x'),
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })
    await acm.maybeCompact(manager)

    // Reload a fresh manager against the same store.
    const fresh = new SessionManager(store)
    const reloaded = fresh.resumeSession(meta.id)
    assert.ok(reloaded)
    assert.ok(reloaded!.summary)
    assert.match(reloaded!.summary!, /Persisted summary line/)
    assert.equal(fresh.getMessages().length, 5)
    assert.equal(fresh.getMessages()[0]!.role, 'system')
  } finally {
    cleanup()
  }
})

// ---------------------------------------------------------------------------
// 10. Re-entry / concurrent-call guard
// ---------------------------------------------------------------------------

test('concurrent maybeCompact calls do not double-compact', async () => {
  const { store, cleanup } = makeTempStore()
  try {
    const manager = new SessionManager(store)
    manager.startSession('/tmp')
    seedSession(manager, 15, 400)

    let providerCalls = 0
    const slowProvider: SummaryProvider = async () => {
      providerCalls++
      await new Promise(r => setTimeout(r, 20))
      return 'Slow summary title\n\n- slow'
    }
    const acm = new AutoCompactionManager({
      provider: slowProvider,
      settings: { threshold: 100, preserveRecent: 4 },
      env: {},
    })

    const [a, b, c] = await Promise.all([
      acm.maybeCompact(manager),
      acm.maybeCompact(manager),
      acm.maybeCompact(manager),
    ])
    const ran = [a, b, c].filter(r => r.ran).length
    assert.equal(ran, 1)
    assert.equal(providerCalls, 1)
  } finally {
    cleanup()
  }
})
