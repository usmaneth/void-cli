/**
 * Render a markdown report from scored replay results and write it to the
 * vault (`~/vault/measurements/`). The path is returned so the skill can
 * echo it back to the user.
 *
 * The report is structured to answer the cross-tool question first: how
 * does each variant compare on cost / latency / success / turns? The
 * detail table is per-prompt for drill-down. A "Notes" section at the
 * bottom highlights the cheapest, the fastest, and any cost or latency
 * spreads worth porting features for.
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { ReplayResult, VariantStats } from './types.js'

export type ReportInputs = {
  results: ReplayResult[]
  stats: VariantStats[]
  /** When this measurement was started (wall clock). */
  startedAt: Date
  projectPath: string
  corpusSize: number
  /** Absolute path to the directory the report will be written into. */
  vaultDir: string
}

/** Format a cost in USD with 4 decimals (covers sub-cent differences). */
function fmtUsd(v: number, available: boolean): string {
  if (!available) return '—'
  if (!Number.isFinite(v)) return '—'
  return `$${v.toFixed(4)}`
}

/** Format a duration in seconds with one decimal. */
function fmtSec(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtNum(v: number, digits = 1, available = true): string {
  if (!available) return '—'
  if (!Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(0)}%`
}

/** Truncate a prompt for inline display. */
function previewPrompt(s: string, max = 120): string {
  const normalized = s.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return normalized.slice(0, max - 1) + '…'
}

/** Build the markdown body for the report. */
export function renderReport(inputs: ReportInputs): string {
  const { results, stats, startedAt, projectPath, corpusSize } = inputs
  const iso = startedAt.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 16)

  const frontmatter = [
    '---',
    `id: ${date}-${time.replace(':', '')}-measurement`,
    `created: ${iso}`,
    'author: claude-code',
    'type: measurement',
    'project: void-cli',
    'tags: [measurement, void-cli, /measure]',
    '---',
  ].join('\n')

  const summary = `# Measurement — ${date} ${time}\n\nReplayed **${corpusSize}** prompts from \`${projectPath}\` across **${stats.length}** variant${stats.length === 1 ? '' : 's'}.`

  const variantList = buildVariantList(stats)
  const summaryTable = buildSummaryTable(stats)
  const detailTable = buildDetailTable(results)
  const notes = buildNotes(stats)

  return `${frontmatter}\n\n${summary}\n\n## Variants\n\n${variantList}\n\n## Summary\n\n${summaryTable}\n\n## Per-Prompt Detail\n\n${detailTable}\n\n## Notes\n\n${notes}\n`
}

function buildVariantList(stats: VariantStats[]): string {
  if (stats.length === 0) return '_No variants._'
  return stats
    .map(s => `- \`${s.variantId}\` — ${s.tool} ${s.version}`)
    .join('\n')
}

function buildSummaryTable(stats: VariantStats[]): string {
  if (stats.length === 0) return '_No variant stats — corpus was empty._'
  const header =
    '| Variant | Tool | Version | N | Success | Cost (mean) | Cost (p95) | Latency (mean) | Latency (p95) | Turns (mean) | Chars (mean) |'
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|'
  const rows = stats.map(s =>
    [
      `\`${s.variantId}\``,
      s.tool,
      s.version,
      s.count,
      fmtPct(s.successRate),
      fmtUsd(s.cost.mean, s.costAvailable),
      fmtUsd(s.cost.p95, s.costAvailable),
      fmtSec(s.latency.mean),
      fmtSec(s.latency.p95),
      fmtNum(s.turns.mean, 1, s.turnsAvailable),
      fmtNum(s.messageChars.mean, 0),
    ].join(' | '),
  )
  return [header, sep, ...rows.map(r => `| ${r} |`)].join('\n')
}

function buildDetailTable(results: ReplayResult[]): string {
  if (results.length === 0) return '_No results._'
  const header =
    '| # | Variant | Prompt | OK | Cost | Latency | Turns | Chars | Error |'
  const sep = '|---|---|---|---|---|---|---|---|---|'
  const rows = results.map((r, i) => {
    const prompt = previewPrompt(r.prompt)
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ')
    const err = r.error
      ? previewPrompt(r.error, 80).replaceAll('|', '\\|')
      : ''
    return [
      i + 1,
      `\`${r.variantId}\``,
      prompt,
      r.ok ? '✓' : '✗',
      fmtUsd(r.costUsd, r.costAvailable),
      fmtSec(r.latencyMs),
      r.numTurns >= 0 ? r.numTurns : '—',
      r.finalMessageChars,
      err,
    ].join(' | ')
  })
  return [header, sep, ...rows.map(r => `| ${r} |`)].join('\n')
}

function buildNotes(stats: VariantStats[]): string {
  if (stats.length === 0) {
    return '- No data to analyze.'
  }
  if (stats.length === 1) {
    const s = stats[0]!
    const costNote = s.costAvailable
      ? `\n- Cheapest call: ${fmtUsd(s.cost.min, true)} | priciest: ${fmtUsd(s.cost.max, true)}.`
      : '\n- Cost data unavailable for this tool/parser.'
    return `- Single-variant run — re-invoke with \`--tools claude,void\` (or similar) to compare across tools.${costNote}\n- Fastest call: ${fmtSec(s.latency.min)} | slowest: ${fmtSec(s.latency.max)}.`
  }

  const lines: string[] = []

  // Cost comparison — only meaningful when at least two variants have cost data.
  const withCost = stats.filter(s => s.costAvailable)
  if (withCost.length >= 2) {
    const byCost = [...withCost].sort((a, b) => a.cost.mean - b.cost.mean)
    const cheapest = byCost[0]!
    const priciest = byCost[byCost.length - 1]!
    lines.push(
      `- Cheapest variant on average: \`${cheapest.variantId}\` at ${fmtUsd(cheapest.cost.mean, true)}/prompt (${fmtPct(cheapest.successRate)} success).`,
    )
    lines.push(
      `- Priciest variant on average: \`${priciest.variantId}\` at ${fmtUsd(priciest.cost.mean, true)}/prompt.`,
    )
    if (cheapest.variantId !== priciest.variantId && priciest.cost.mean > 0) {
      const ratio = priciest.cost.mean / cheapest.cost.mean
      if (ratio > 1) {
        lines.push(
          `- Cost ratio (priciest / cheapest): **${fmtNum(ratio, 1)}x**.`,
        )
      }
    }
  } else if (withCost.length === 1) {
    lines.push(
      `- Cost data only available for \`${withCost[0]!.variantId}\` — other tools' parsers don't expose cost yet.`,
    )
  } else {
    lines.push('- No variant reported cost data; comparison limited to latency and success rate.')
  }

  // Latency comparison — always available.
  const byLatency = [...stats].sort((a, b) => a.latency.mean - b.latency.mean)
  const fastest = byLatency[0]!
  const slowest = byLatency[byLatency.length - 1]!
  lines.push(
    `- Fastest variant on average: \`${fastest.variantId}\` at ${fmtSec(fastest.latency.mean)}/prompt.`,
  )
  lines.push(
    `- Slowest variant on average: \`${slowest.variantId}\` at ${fmtSec(slowest.latency.mean)}/prompt.`,
  )
  if (fastest.variantId !== slowest.variantId && fastest.latency.mean > 0) {
    const ratio = slowest.latency.mean / fastest.latency.mean
    if (ratio > 1) {
      lines.push(
        `- Latency ratio (slowest / fastest): **${fmtNum(ratio, 1)}x**.`,
      )
    }
  }

  // Feature parity hint: if there's a void variant and a non-void variant
  // with substantially different success rates, surface it.
  const voidStats = stats.find(s => s.tool === 'void')
  const otherStats = stats.filter(s => s.tool !== 'void')
  if (voidStats && otherStats.length > 0) {
    for (const other of otherStats) {
      const gap = other.successRate - voidStats.successRate
      if (Math.abs(gap) >= 0.2) {
        const lead = gap > 0 ? other.variantId : voidStats.variantId
        const trail = gap > 0 ? voidStats.variantId : other.variantId
        lines.push(
          `- ⚠ Success-rate gap: \`${lead}\` is ${fmtPct(Math.abs(gap))} ahead of \`${trail}\`. Worth investigating which behaviors close the gap.`,
        )
      }
    }
  }

  return lines.join('\n')
}

/** Build the filename for a measurement report — collision-free per minute. */
export function buildReportFilename(startedAt: Date): string {
  const iso = startedAt.toISOString()
  const yyyy = iso.slice(0, 4)
  const mm = iso.slice(5, 7)
  const dd = iso.slice(8, 10)
  const hh = iso.slice(11, 13)
  const mi = iso.slice(14, 16)
  return `${yyyy}-${mm}-${dd}-${hh}${mi}-measurement.md`
}

/**
 * Render and write the report. Returns the absolute path written.
 * Creates `vaultDir` (and its parents) if missing — does not fail on a
 * first-time vault setup.
 */
export async function writeReport(inputs: ReportInputs): Promise<string> {
  const body = renderReport(inputs)
  const filename = buildReportFilename(inputs.startedAt)
  const target = join(inputs.vaultDir, filename)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
  return target
}
