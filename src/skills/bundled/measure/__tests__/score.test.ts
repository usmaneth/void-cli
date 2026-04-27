/**
 * Tests for score.ts — variant aggregation and per-variant grouping.
 */
import { describe, expect, it } from 'vitest'
import { computeAggStats, scoreByVariant } from '../score.js'
import type { ReplayResult, ToolName } from '../types.js'

function r(opts: {
  variantId: string
  tool?: ToolName
  version?: string
  ok?: boolean
  costUsd?: number
  costAvailable?: boolean
  latencyMs?: number
  numTurns?: number
  finalMessageChars?: number
}): ReplayResult {
  return {
    prompt: 'p',
    variantId: opts.variantId,
    tool: opts.tool ?? 'void',
    version: opts.version ?? '0.0.0',
    ok: opts.ok ?? true,
    costUsd: opts.costUsd ?? 0,
    costAvailable: opts.costAvailable ?? false,
    latencyMs: opts.latencyMs ?? 0,
    apiLatencyMs: -1,
    numTurns: opts.numTurns ?? -1,
    finalMessageChars: opts.finalMessageChars ?? 0,
    sessionId: 's',
    rawExitCode: 0,
  }
}

describe('computeAggStats', () => {
  it('returns zeros for an empty input', () => {
    expect(computeAggStats([])).toEqual({ mean: 0, median: 0, p95: 0, min: 0, max: 0 })
  })

  it('computes mean/median/min/max on a single value', () => {
    const s = computeAggStats([7])
    expect(s.mean).toBe(7)
    expect(s.median).toBe(7)
    expect(s.min).toBe(7)
    expect(s.max).toBe(7)
    expect(s.p95).toBe(7)
  })

  it('computes mean and median on a sorted set', () => {
    const s = computeAggStats([1, 2, 3, 4, 5])
    expect(s.mean).toBe(3)
    expect(s.median).toBe(3)
    expect(s.min).toBe(1)
    expect(s.max).toBe(5)
  })

  it('does not mutate the input array', () => {
    const input = [3, 1, 2]
    computeAggStats(input)
    expect(input).toEqual([3, 1, 2])
  })

  it('p95 lands at or near the top decile', () => {
    const s = computeAggStats(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(s.p95).toBeGreaterThanOrEqual(95)
    expect(s.p95).toBeLessThanOrEqual(100)
  })
})

describe('scoreByVariant', () => {
  it('returns an empty array for no results', () => {
    expect(scoreByVariant([])).toEqual([])
  })

  it('groups by variantId and sorts deterministically', () => {
    const stats = scoreByVariant([
      r({ variantId: 'void', tool: 'void', costUsd: 0.1, costAvailable: true, latencyMs: 1000, numTurns: 1, finalMessageChars: 100 }),
      r({ variantId: 'claude', tool: 'claude', costUsd: 0.05, costAvailable: true, latencyMs: 500, numTurns: 1, finalMessageChars: 50 }),
      r({ variantId: 'void', tool: 'void', costUsd: 0.2, costAvailable: true, latencyMs: 2000, numTurns: 2, finalMessageChars: 200 }),
    ])
    expect(stats.map(s => s.variantId)).toEqual(['claude', 'void'])
    const voidStats = stats.find(s => s.variantId === 'void')!
    expect(voidStats.count).toBe(2)
    expect(voidStats.cost.mean).toBeCloseTo(0.15, 5)
    expect(voidStats.tool).toBe('void')
  })

  it('counts failures toward the total but excludes them from quality stats', () => {
    const stats = scoreByVariant([
      r({ variantId: 'void', costUsd: 0.1, costAvailable: true, latencyMs: 1000, ok: true }),
      r({ variantId: 'void', costUsd: 0.05, costAvailable: true, latencyMs: 0, ok: false }),
    ])
    const s = stats[0]!
    expect(s.count).toBe(2)
    expect(s.successCount).toBe(1)
    expect(s.successRate).toBe(0.5)
    // Latency excludes the failed run
    expect(s.latency.mean).toBe(1000)
  })

  it('flags costAvailable: false when no result reported cost', () => {
    const stats = scoreByVariant([
      r({ variantId: 'codex', tool: 'codex', costAvailable: false, ok: true, latencyMs: 500 }),
      r({ variantId: 'codex', tool: 'codex', costAvailable: false, ok: true, latencyMs: 700 }),
    ])
    expect(stats[0]!.costAvailable).toBe(false)
    expect(stats[0]!.cost.mean).toBe(0)
    // Latency still computed normally
    expect(stats[0]!.latency.mean).toBe(600)
  })

  it('flags turnsAvailable: false when no result reported turns', () => {
    const stats = scoreByVariant([
      r({ variantId: 'codex', tool: 'codex', numTurns: -1, ok: true, latencyMs: 500 }),
    ])
    expect(stats[0]!.turnsAvailable).toBe(false)
    expect(stats[0]!.turns.mean).toBe(0)
  })

  it('sets turnsAvailable: true when at least one result has turns', () => {
    const stats = scoreByVariant([
      r({ variantId: 'void', numTurns: 3, ok: true, latencyMs: 500 }),
      r({ variantId: 'void', numTurns: 5, ok: true, latencyMs: 600 }),
    ])
    expect(stats[0]!.turnsAvailable).toBe(true)
    expect(stats[0]!.turns.mean).toBe(4)
  })

  it('reports a 0% success rate when every run failed', () => {
    const stats = scoreByVariant([
      r({ variantId: 'void', ok: false }),
      r({ variantId: 'void', ok: false }),
    ])
    expect(stats[0]!.successRate).toBe(0)
    // Latency stats over an empty success set should be zero, not NaN.
    expect(stats[0]!.latency.mean).toBe(0)
  })

  it('captures tool + version from the first result in a group', () => {
    const stats = scoreByVariant([
      r({ variantId: 'claude', tool: 'claude', version: '2.1.119' }),
    ])
    expect(stats[0]!.tool).toBe('claude')
    expect(stats[0]!.version).toBe('2.1.119')
  })
})
