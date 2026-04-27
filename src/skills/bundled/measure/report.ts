/**
 * Render a markdown report from scored replay results and write it to the
 * vault (`~/vault/measurements/`). The path is returned so the skill can
 * echo it back to the user.
 *
 * We strip model names and session IDs from the per-prompt detail table but
 * keep the first 120 chars of each prompt. Full prompts can be recovered
 * from `~/.void/history.jsonl` if needed — no need to duplicate them here.
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { ModelStats, ReplayResult } from './types.js'

export type ReportInputs = {
  results: ReplayResult[]
  stats: ModelStats[]
  /** When this measurement was started (wall clock). */
  startedAt: Date
  projectPath: string
  corpusSize: number
  /** Absolute path to the directory the report will be written into. */
  vaultDir: string
}

/** Format a cost in USD with 4 decimals (covers sub-cent differences). */
function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return `$${v.toFixed(4)}`
}

/** Format a duration in seconds with one decimal. */
function fmtSec(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtNum(v: number, digits = 1): string {
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

  const summary = `# Measurement — ${date} ${time}\n\nReplayed **${corpusSize}** prompts from \`${projectPath}\` across **${stats.length}** model configuration${stats.length === 1 ? '' : 's'}.`

  const summaryTable = buildSummaryTable(stats)
  const detailTable = buildDetailTable(results)
  const notes = buildNotes(stats)

  return `${frontmatter}\n\n${summary}\n\n## Summary\n\n${summaryTable}\n\n## Per-Prompt Detail\n\n${detailTable}\n\n## Notes\n\n${notes}\n`
}

function buildSummaryTable(stats: ModelStats[]): string {
  if (stats.length === 0) return '_No model stats — corpus was empty._'
  const header =
    '| Model | N | Success | Cost (mean) | Cost (p95) | Latency (mean) | Latency (p95) | Turns (mean) | Chars (mean) |'
  const sep =
    '|---|---|---|---|---|---|---|---|---|'
  const rows = stats.map(s =>
    [
      `\`${s.model}\``,
      s.count,
      fmtPct(s.successRate),
      fmtUsd(s.cost.mean),
      fmtUsd(s.cost.p95),
      fmtSec(s.latency.mean),
      fmtSec(s.latency.p95),
      fmtNum(s.turns.mean, 1),
      fmtNum(s.messageChars.mean, 0),
    ].join(' | '),
  )
  return [header, sep, ...rows.map(r => `| ${r} |`)].join('\n')
}

function buildDetailTable(results: ReplayResult[]): string {
  if (results.length === 0) return '_No results._'
  const header = '| # | Model | Prompt | OK | Cost | Latency | Turns | Chars | Error |'
  const sep = '|---|---|---|---|---|---|---|---|---|'
  const rows = results.map((r, i) => {
    const prompt = previewPrompt(r.prompt)
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ')
    const err = r.error ? previewPrompt(r.error, 80).replaceAll('|', '\\|') : ''
    return [
      i + 1,
      `\`${r.model}\``,
      prompt,
      r.ok ? '✓' : '✗',
      fmtUsd(r.costUsd),
      fmtSec(r.latencyMs),
      r.numTurns,
      r.finalMessageChars,
      err,
    ].join(' | ')
  })
  return [header, sep, ...rows.map(r => `| ${r} |`)].join('\n')
}

function buildNotes(stats: ModelStats[]): string {
  if (stats.length === 0) {
    return '- No data to analyze.'
  }
  if (stats.length === 1) {
    const s = stats[0]!
    return `- Single-configuration run — re-invoke with \`--models\` to compare variants.\n- Cheapest call: ${fmtUsd(s.cost.min)} | priciest: ${fmtUsd(s.cost.max)}.\n- Fastest call: ${fmtSec(s.latency.min)} | slowest: ${fmtSec(s.latency.max)}.`
  }
  const byCost = [...stats].sort((a, b) => a.cost.mean - b.cost.mean)
  const cheapest = byCost[0]!
  const priciest = byCost[byCost.length - 1]!
  const byLatency = [...stats].sort((a, b) => a.latency.mean - b.latency.mean)
  const fastest = byLatency[0]!
  const slowest = byLatency[byLatency.length - 1]!
  const lines = [
    `- Cheapest model on average: \`${cheapest.model}\` at ${fmtUsd(cheapest.cost.mean)}/prompt (${fmtPct(cheapest.successRate)} success).`,
    `- Priciest model on average: \`${priciest.model}\` at ${fmtUsd(priciest.cost.mean)}/prompt.`,
    `- Fastest model on average: \`${fastest.model}\` at ${fmtSec(fastest.latency.mean)}/prompt.`,
    `- Slowest model on average: \`${slowest.model}\` at ${fmtSec(slowest.latency.mean)}/prompt.`,
  ]
  if (cheapest.model !== priciest.model) {
    const ratio =
      priciest.cost.mean === 0 ? 0 : priciest.cost.mean / cheapest.cost.mean
    if (ratio > 1) {
      lines.push(
        `- Cost ratio (priciest / cheapest): **${fmtNum(ratio, 1)}x**.`,
      )
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
