/**
 * Tests for report.ts — markdown rendering and filename construction.
 */
import { describe, expect, it } from 'vitest'
import { buildReportFilename, renderReport } from '../report.js'
import type { ReplayResult, VariantStats } from '../types.js'

const SINGLE_STATS: VariantStats[] = [
  {
    variantId: 'void',
    tool: 'void',
    version: '2.1.94',
    count: 2,
    successCount: 2,
    successRate: 1,
    costAvailable: true,
    cost: { mean: 0.1, median: 0.1, p95: 0.15, min: 0.05, max: 0.15 },
    latency: { mean: 1000, median: 1000, p95: 1500, min: 500, max: 1500 },
    turnsAvailable: true,
    turns: { mean: 2, median: 2, p95: 3, min: 1, max: 3 },
    messageChars: { mean: 100, median: 100, p95: 200, min: 50, max: 200 },
  },
]

const TWO_STATS: VariantStats[] = [
  ...SINGLE_STATS,
  {
    variantId: 'claude',
    tool: 'claude',
    version: '2.1.119',
    count: 2,
    successCount: 2,
    successRate: 1,
    costAvailable: true,
    cost: { mean: 0.02, median: 0.02, p95: 0.03, min: 0.01, max: 0.03 },
    latency: { mean: 500, median: 500, p95: 800, min: 200, max: 800 },
    turnsAvailable: true,
    turns: { mean: 1, median: 1, p95: 2, min: 1, max: 2 },
    messageChars: { mean: 50, median: 50, p95: 100, min: 25, max: 100 },
  },
]

const SAMPLE_RESULTS: ReplayResult[] = [
  {
    prompt: 'fix the bug',
    variantId: 'void',
    tool: 'void',
    version: '2.1.94',
    ok: true,
    costUsd: 0.05,
    costAvailable: true,
    latencyMs: 500,
    apiLatencyMs: 400,
    numTurns: 1,
    finalMessageChars: 50,
    sessionId: 's1',
    rawExitCode: 0,
  },
  {
    prompt: 'explain the diff',
    variantId: 'void',
    tool: 'void',
    version: '2.1.94',
    ok: false,
    costUsd: 0,
    costAvailable: false,
    latencyMs: 2000,
    apiLatencyMs: -1,
    numTurns: -1,
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
    expect(md).toContain('## Variants')
    expect(md).toContain('## Summary')
    expect(md).toContain('## Per-Prompt Detail')
    expect(md).toContain('## Notes')
  })

  it('lists variants with tool and version', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: TWO_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toContain('void 2.1.94')
    expect(md).toContain('claude 2.1.119')
  })

  it('renders a summary table row per variant', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: TWO_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toContain('| `void` |')
    expect(md).toContain('| `claude` |')
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

  it('shows — for cost when costAvailable is false', () => {
    const md = renderReport({
      results: [
        {
          ...SAMPLE_RESULTS[0]!,
          costAvailable: false,
          costUsd: 0,
        },
      ],
      stats: [
        {
          ...SINGLE_STATS[0]!,
          costAvailable: false,
          cost: { mean: 0, median: 0, p95: 0, min: 0, max: 0 },
        },
      ],
      startedAt,
      projectPath: '/p',
      corpusSize: 1,
      vaultDir: '/vault',
    })
    expect(md).toContain('—')
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

  it('emits cross-tool comparison notes when more than one variant', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: TWO_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toMatch(/Cheapest variant on average/)
    expect(md).toMatch(/Cost ratio/)
    expect(md).toMatch(/Fastest variant on average/)
  })

  it('emits a single-variant note when only one variant was run', () => {
    const md = renderReport({
      results: SAMPLE_RESULTS,
      stats: SINGLE_STATS,
      startedAt,
      projectPath: '/p',
      corpusSize: 2,
      vaultDir: '/vault',
    })
    expect(md).toMatch(/Single-variant run/)
  })

  it('flags a success-rate gap between void and another tool', () => {
    const stats: VariantStats[] = [
      { ...SINGLE_STATS[0]!, successRate: 0.4, successCount: 4, count: 10 },
      {
        variantId: 'claude',
        tool: 'claude',
        version: '2.1.119',
        count: 10,
        successCount: 9,
        successRate: 0.9,
        costAvailable: true,
        cost: { mean: 0.02, median: 0.02, p95: 0.03, min: 0.01, max: 0.03 },
        latency: { mean: 500, median: 500, p95: 800, min: 200, max: 800 },
        turnsAvailable: true,
        turns: { mean: 1, median: 1, p95: 2, min: 1, max: 2 },
        messageChars: { mean: 50, median: 50, p95: 100, min: 25, max: 100 },
      },
    ]
    const md = renderReport({
      results: [],
      stats,
      startedAt,
      projectPath: '/p',
      corpusSize: 10,
      vaultDir: '/vault',
    })
    expect(md).toMatch(/Success-rate gap/)
    expect(md).toContain('claude')
  })
})

describe('buildReportFilename', () => {
  it('emits a sortable filename with date and time', () => {
    const fn = buildReportFilename(new Date('2026-04-25T12:34:00Z'))
    expect(fn).toBe('2026-04-25-1234-measurement.md')
  })

  it('two reports started in the same minute share a filename', () => {
    const a = buildReportFilename(new Date('2026-04-25T12:34:00Z'))
    const b = buildReportFilename(new Date('2026-04-25T12:34:59Z'))
    expect(a).toBe(b)
  })
})
