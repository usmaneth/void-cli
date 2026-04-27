/**
 * Aggregate replay results into per-model statistics.
 *
 * All arithmetic is explicit; no reliance on stats libraries. Results are
 * stable: empty input yields zero-valued stats rather than NaN so report
 * rendering never shows `NaN` cells.
 */

import type { AggStats, ModelStats, ReplayResult } from './types.js'

/** Compute mean, median, p95, min, max over a list of numeric values. */
export function computeAggStats(values: number[]): AggStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, p95: 0, min: 0, max: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = sum / sorted.length
  const median = quantile(sorted, 0.5)
  const p95 = quantile(sorted, 0.95)
  return {
    mean,
    median,
    p95,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

/** Linear-interpolated quantile; expects a pre-sorted ascending array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * q
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) return sorted[lower]!
  const frac = pos - lower
  return sorted[lower]! * (1 - frac) + sorted[upper]! * frac
}

/** Group replay results by model and compute stats per group. */
export function scoreByModel(results: ReplayResult[]): ModelStats[] {
  const byModel = new Map<string, ReplayResult[]>()
  for (const r of results) {
    const group = byModel.get(r.model)
    if (group) group.push(r)
    else byModel.set(r.model, [r])
  }
  const stats: ModelStats[] = []
  for (const [model, group] of byModel.entries()) {
    // For quality metrics (latency/turns/chars) only include successful runs:
    // failed runs have zeroes which would drag the mean toward noise.
    const successes = group.filter(r => r.ok)
    const successCount = successes.length
    stats.push({
      model,
      count: group.length,
      successCount,
      successRate: group.length === 0 ? 0 : successCount / group.length,
      // Cost includes failed runs — a run that errored after partial work
      // still costs money, and pretending otherwise understates the bill.
      cost: computeAggStats(group.map(r => r.costUsd)),
      latency: computeAggStats(successes.map(r => r.latencyMs)),
      turns: computeAggStats(successes.map(r => r.numTurns)),
      messageChars: computeAggStats(successes.map(r => r.finalMessageChars)),
    })
  }
  // Sort by model name for stable report output.
  stats.sort((a, b) => a.model.localeCompare(b.model))
  return stats
}
