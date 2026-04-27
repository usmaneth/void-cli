/**
 * Tests for score.ts — aggregate stats and per-model grouping.
 */
import { describe, expect, it } from 'vitest'
import { computeAggStats, scoreByModel } from '../score.js'
import type { ReplayResult } from '../types.js'

function r(model: string, ok: boolean, costUsd: number, latencyMs: number, turns: number, chars: number): ReplayResult {
  return {
    prompt: 'p',
    model,
    ok,
    costUsd,
    latencyMs,
    apiLatencyMs: latencyMs,
    numTurns: turns,
    finalMessageChars: chars,
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

describe('scoreByModel', () => {
  it('returns an empty array for no results', () => {
    expect(scoreByModel([])).toEqual([])
  })

  it('groups by model and sorts by name', () => {
    const stats = scoreByModel([
      r('opus', true, 0.1, 1000, 1, 100),
      r('sonnet', true, 0.05, 500, 1, 50),
      r('opus', true, 0.2, 2000, 2, 200),
    ])
    expect(stats.map(s => s.model)).toEqual(['opus', 'sonnet'])
    const opus = stats.find(s => s.model === 'opus')!
    expect(opus.count).toBe(2)
    expect(opus.cost.mean).toBeCloseTo(0.15, 5)
  })

  it('counts failures toward the total but excludes them from quality stats', () => {
    const stats = scoreByModel([
      r('opus', true, 0.1, 1000, 1, 100),
      r('opus', false, 0.05, 0, 0, 0), // failed run; cost still counts
    ])
    const s = stats[0]!
    expect(s.count).toBe(2)
    expect(s.successCount).toBe(1)
    expect(s.successRate).toBe(0.5)
    // latency ignores the failed run (zeroes would skew toward noise)
    expect(s.latency.mean).toBe(1000)
    // cost does include the failed run — partial work still costs money
    expect(s.cost.mean).toBeCloseTo(0.075, 5)
  })

  it('reports a 0% success rate when every run failed', () => {
    const stats = scoreByModel([
      r('opus', false, 0, 0, 0, 0),
      r('opus', false, 0, 0, 0, 0),
    ])
    expect(stats[0]!.successRate).toBe(0)
    // Latency stats over an empty success set should be zero, not NaN.
    expect(stats[0]!.latency.mean).toBe(0)
  })
})
