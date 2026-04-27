/**
 * Aggregate replay results into per-variant statistics.
 *
 * "Variant" is the unit of comparison: a tool + version + optional model
 * override. Grouping by variant id lets us answer "is void@2.1.94 still
 * keeping pace with claude@2.1.119?" rather than only "opus vs sonnet."
 *
 * All arithmetic is explicit; no reliance on stats libraries. Empty input
 * yields zero-valued stats rather than NaN so report rendering never
 * shows `NaN` cells.
 */

import type { AggStats, ReplayResult, VariantStats } from './types.js'

/** Compute mean, median, p95, min, max over a list of numeric values. */
export function computeAggStats(values: number[]): AggStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, p95: 0, min: 0, max: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = sum / sorted.length
  return {
    mean,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
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

/** Group replay results by variant id and compute stats per group. */
export function scoreByVariant(results: ReplayResult[]): VariantStats[] {
  const byId = new Map<string, ReplayResult[]>()
  for (const r of results) {
    const group = byId.get(r.variantId)
    if (group) group.push(r)
    else byId.set(r.variantId, [r])
  }

  const stats: VariantStats[] = []
  for (const [variantId, group] of byId.entries()) {
    // For quality metrics (latency/turns/chars) only include successful
    // runs: failed runs have zeroes which would drag means toward noise.
    const successes = group.filter(r => r.ok)
    const successCount = successes.length

    // Cost is reported only when at least one parsable run had it.
    const withCost = successes.filter(r => r.costAvailable)
    const costAvailable = withCost.length > 0

    // Turns are reported only when at least one parsable run had them.
    const withTurns = successes.filter(r => r.numTurns >= 0)
    const turnsAvailable = withTurns.length > 0

    const first = group[0]!
    stats.push({
      variantId,
      tool: first.tool,
      version: first.version,
      count: group.length,
      successCount,
      successRate: group.length === 0 ? 0 : successCount / group.length,
      costAvailable,
      // Cost includes failed runs *when cost is available* — a partially
      // executed run still costs money. When cost isn't available at all,
      // the AggStats are zero (and the report renderer shows "—").
      cost: costAvailable
        ? computeAggStats(
            group.filter(r => r.costAvailable).map(r => r.costUsd),
          )
        : computeAggStats([]),
      latency: computeAggStats(successes.map(r => r.latencyMs)),
      turnsAvailable,
      turns: turnsAvailable
        ? computeAggStats(withTurns.map(r => r.numTurns))
        : computeAggStats([]),
      messageChars: computeAggStats(successes.map(r => r.finalMessageChars)),
    })
  }

  // Sort by variant id for stable report output.
  stats.sort((a, b) => a.variantId.localeCompare(b.variantId))
  return stats
}
