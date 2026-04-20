/**
 * Tests for the frecency store. Uses node:test so no new dev dep is required.
 * Run with: node --test --experimental-strip-types src/services/frecency/store.test.ts
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { calculateFrecency, FrecencyStore } from './store.js'

describe('calculateFrecency', () => {
  it('returns 0 for zero-count entries', () => {
    assert.equal(calculateFrecency({ count: 0, lastAccess: Date.now() }), 0)
  })

  it('returns count for a just-accessed entry (within the same hour)', () => {
    const now = 1_700_000_000_000
    const score = calculateFrecency({ count: 5, lastAccess: now }, now)
    // Age = 0 hours -> denom = 1 + log2(1) = 1, so score == count
    assert.equal(score, 5)
  })

  it('decays logarithmically with hours since last access', () => {
    const now = 1_700_000_000_000
    const oneHour = 60 * 60 * 1000

    // 1 hour later: denom = 1 + log2(2) = 2 -> count / 2
    const at1h = calculateFrecency({ count: 10, lastAccess: now - oneHour }, now)
    assert.equal(at1h, 5)

    // 3 hours later: denom = 1 + log2(4) = 3 -> count / 3
    const at3h = calculateFrecency({ count: 10, lastAccess: now - 3 * oneHour }, now)
    assert.equal(at3h, 10 / 3)

    // Monotonic decay
    assert.ok(at1h > at3h)
  })

  it('frequent-old beats recent-once for realistic values', () => {
    const now = 1_700_000_000_000
    const oneHour = 60 * 60 * 1000
    // Accessed 30 times a day ago vs accessed once an hour ago
    const dayAgoFrequent = calculateFrecency(
      { count: 30, lastAccess: now - 24 * oneHour },
      now,
    )
    const hourAgoRare = calculateFrecency(
      { count: 1, lastAccess: now - oneHour },
      now,
    )
    assert.ok(dayAgoFrequent > hourAgoRare)
  })
})

describe('FrecencyStore', () => {
  let tmp: string
  let storePath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frecency-'))
    storePath = path.join(tmp, 'frecency.json')
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('bump increments count and updates lastAccess', () => {
    const store = new FrecencyStore({ filePath: storePath, memoryOnly: true })
    const before = Date.now()
    store.bump('/foo/bar.ts')
    const score1 = store.score('/foo/bar.ts', before)
    assert.ok(score1 > 0)
    store.bump('/foo/bar.ts')
    // Two bumps close together: roughly doubles score
    const score2 = store.score('/foo/bar.ts', before)
    assert.ok(score2 > score1)
  })

  it('ranks a recently-bumped file above a stale one', () => {
    const store = new FrecencyStore({ filePath: storePath, memoryOnly: true })
    const old = Date.now() - 72 * 60 * 60 * 1000 // 3 days ago
    store.bump('/a/fresh.ts', Date.now())
    store.bump('/a/stale.ts', old)
    const top = store.topByFrecency(5)
    assert.equal(top[0]?.path, path.resolve('/a/fresh.ts'))
    assert.equal(top[1]?.path, path.resolve('/a/stale.ts'))
  })

  it('persists to disk and reloads', () => {
    const store = new FrecencyStore({
      filePath: storePath,
      flushDelayMs: 0,
    })
    store.bump('/x/y.ts')
    store.bump('/x/y.ts')
    store.flush()
    assert.ok(fs.existsSync(storePath))

    const store2 = new FrecencyStore({ filePath: storePath })
    store2.load()
    assert.equal(store2.size(), 1)
    assert.ok(store2.score('/x/y.ts') > 0)
  })

  it('evicts the lowest-frecency entry when over capacity', () => {
    const store = new FrecencyStore({
      filePath: storePath,
      memoryOnly: true,
      maxEntries: 2,
    })
    const now = Date.now()
    // Old but frequent
    store.bump('/a', now - 7 * 24 * 60 * 60 * 1000)
    store.bump('/a', now - 7 * 24 * 60 * 60 * 1000)
    // Recent one-hit
    store.bump('/b', now)
    // Fresh one-hit causing eviction
    store.bump('/c', now)
    assert.equal(store.size(), 2)
    // /a had count=2 with decay ~ 2/log(~168+1)=~0.25, /b and /c both have
    // count=1 fresh -> score 1. /a should evict.
    assert.equal(store.score('/a'), 0)
  })

  it('tolerates corrupt files on load', () => {
    fs.writeFileSync(storePath, '{not valid json')
    const store = new FrecencyStore({ filePath: storePath, flushDelayMs: 0 })
    store.load()
    assert.equal(store.size(), 0)
    // Should still be usable
    store.bump('/q.ts')
    assert.ok(store.score('/q.ts') > 0)
  })

  it('remove drops entry', () => {
    const store = new FrecencyStore({ filePath: storePath, memoryOnly: true })
    store.bump('/a.ts')
    assert.equal(store.size(), 1)
    store.remove('/a.ts')
    assert.equal(store.size(), 0)
  })
})
