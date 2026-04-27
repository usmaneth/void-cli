/**
 * Tests for report.ts — markdown rendering and filename construction.
 */
import { describe, expect, it } from 'vitest'
import { buildReportFilename, renderReport } from '../report.js'
import type { ModelStats, ReplayResult } from '../types.js'

const SINGLE_STATS: ModelStats[] = [
  {
    model: 'opus',
    count: 2,
    successCount: 2,
    successRate: 1,
    cost: { mean: 0.1, median: 0.1, p95: 0.15, min: 0.05, max: 0.15 },
    latency: { mean: 1000, median: 1000, p95: 1500, min: 500, max: 1500 },
    turns: { mean: 2, median: 2, p95: 3, min: 1, max: 3 },
    messageChars: { mean: 100, median: 100, p95: 200, min: 50, max: 200 },
  },
]

const TWO_STATS: ModelStats[] = [
  ...SINGLE_STATS,
  {
    model: 'sonnet',
    count: 2,
    successCount: 2,
    successRate: 1,
    cost: { mean: 0.02, median: 0.02, p95: 0.03, min: 0.01, max: 0.03 },
    latency: { mean: 500, median: 500, p95: 800, min: 200, max: 800 },
    turns: { mean: 1, median: 1, p95: 2, min: 1, max: 2 },
    messageChars: { mean: 50, median: 50, p95: 100, min: 25, max: 100 },
  },
]

const SAMPLE_RESULTS: ReplayResult[] = [
  {
    prompt: 'fix the bug',
    model: 'opus',
    ok: true,
    costUsd: 0.05,
    latencyMs: 500,
    apiLatencyMs: 400,
    numTurns: 1,
    finalMessageChars: 50,
    sessionId: 's1',
    rawExitCode: 0,
  },
  {
    prompt: 'explain the diff',
    model: 'opus',
    ok: false,
    costUsd: 0,
    latencyMs: 2000,
    apiLatencyMs: 0,
    numTurns: 0,
    finalMessageChars: 0,
    sessionId: '',
    rawExitCode: 124,
    error: 'timeout after 60000ms',
  },
]

describe('renderReport', () => {
  const startedAt = new Date('2026-04-25T12:34:00Z')

  it('emits frontmatter followed by sections', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: SINGLE_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('id: 2026-04-25-1234-measurement')
    expect(md).toContain('## Summary')
    expect(md).toContain('## Per-Prompt Detail')
    expect(md).toContain('## Notes')
  })

  it('renders a summary table row per model', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: TWO_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toContain('| `opus` |')
    expect(md).toContain('| `sonnet` |')
  })

  it('marks a failed run with ✗ and includes the error', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: SINGLE_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toContain('✗')
    expect(md).toContain('timeout after 60000ms')
  })

  it('escapes pipe characters in prompts to keep the table well-formed', () => {
    const md = renderReport({
      results: [{ ...SAMPLE_RESULTS[0]!, prompt: 'cmd | grep foo' }],
      stats: SINGLE_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 1,
      vaultDir: '/vault',
    })
    expect(md).toContain('cmd \\| grep foo')
  })

  it('emits comparison notes when more than one model is present', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: TWO_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toMatch(/Cheapest model on average/)
    expect(md).toMatch(/Cost ratio/)
  })

  it('emits a single-config note when only one model was run', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: SINGLE_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toMatch(/Single-configuration run/)
  })
})

describe('buildReportFilename', () => {
  it('emits a sortable filename with date and time', () => {
    const fn = buildReportFilename(new Date('2026-04-25T12:34:00Z'))
    expect(fn).toBe('2026-04-25-1234-measurement.md')
  })

  it('two reports started in the same minute share a filename', () => {
    // Documenting the contract — same-minute calls collide. The skill caller
    // should sleep a minute, or accept the overwrite. Cheap to fix later if
    // it bites.
    const a = buildReportFilename(new Date('2026-04-25T12:34:00Z'))
    const b = buildReportFilename(new Date('2026-04-25T12:34:59Z'))
    expect(a).toBe(b)
  })
})
