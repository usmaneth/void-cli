/**
 * Tests for the /measure skill's pure parser, options builder, and
 * variant builder. We don't exercise runMeasure here — it spawns
 * subprocesses and writes to disk.
 */
import { describe, expect, it } from 'vitest'
import {
  buildMeasureOptions,
  buildVariants,
  formatDetectedTools,
  parseMeasureArgs,
} from '../measure.js'
import {
  DEFAULT_N,
  DEFAULT_PARALLEL,
  DEFAULT_TIMEOUT_MS,
  MAX_N,
  MAX_PARALLEL,
  type DetectedTool,
} from '../types.js'

const VOID_TOOL: DetectedTool = {
  name: 'void',
  binary: '/usr/local/bin/void',
  version: '2.1.94 (Void)',
}

const CLAUDE_TOOL: DetectedTool = {
  name: 'claude',
  binary: '/usr/local/bin/claude',
  version: '2.1.119 (Claude Code)',
}

const CODEX_TOOL: DetectedTool = {
  name: 'codex',
  binary: '/opt/homebrew/bin/codex',
  version: 'codex-cli 0.124.0',
}

describe('parseMeasureArgs', () => {
  it('returns defaults when given no args', () => {
    expect(parseMeasureArgs('')).toEqual({
      mode: 'measure',
      modeArg: undefined,
      n: DEFAULT_N,
      tools: 'auto',
      models: [],
      parallel: DEFAULT_PARALLEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      list: false,
    })
  })

  it('parses the suggest mode without a positional arg', () => {
    expect(parseMeasureArgs('suggest').mode).toBe('suggest')
  })

  it('parses the apply mode with a plan-id positional arg', () => {
    const out = parseMeasureArgs('apply 2026-04-27-1234')
    expect(out.mode).toBe('apply')
    expect(out.modeArg).toBe('2026-04-27-1234')
  })

  it('parses the loop mode', () => {
    expect(parseMeasureArgs('loop').mode).toBe('loop')
  })

  it('treats unknown first tokens as flags, not modes', () => {
    expect(parseMeasureArgs('-n 5').mode).toBe('measure')
  })

  it('keeps mode-mode flag combinations: `suggest --tools claude,void`', () => {
    const out = parseMeasureArgs('suggest --tools claude,void')
    expect(out.mode).toBe('suggest')
    expect(out.tools).toEqual(['claude', 'void'])
  })

  it('parses -n and --count interchangeably', () => {
    expect(parseMeasureArgs('-n 5').n).toBe(5)
    expect(parseMeasureArgs('--count 7').n).toBe(7)
  })

  it('caps n at MAX_N', () => {
    expect(parseMeasureArgs(`-n ${MAX_N + 100}`).n).toBe(MAX_N)
  })

  it('ignores invalid n values and keeps the default', () => {
    expect(parseMeasureArgs('-n notanumber').n).toBe(DEFAULT_N)
    expect(parseMeasureArgs('-n -5').n).toBe(DEFAULT_N)
    expect(parseMeasureArgs('-n 0').n).toBe(DEFAULT_N)
  })

  it('parses --tools as a list of valid tool names only', () => {
    const out = parseMeasureArgs('--tools void,claude,bogus,codex')
    expect(out.tools).toEqual(['void', 'claude', 'codex'])
  })

  it('falls back to auto when --tools has no valid entries', () => {
    expect(parseMeasureArgs('--tools bogus,foo').tools).toBe('auto')
  })

  it('parses --models as comma-separated', () => {
    expect(parseMeasureArgs('--models opus,sonnet,haiku').models).toEqual([
      'opus',
      'sonnet',
      'haiku',
    ])
  })

  it('drops empty entries from --models (e.g. trailing commas)', () => {
    expect(parseMeasureArgs('--models opus,,sonnet,').models).toEqual([
      'opus',
      'sonnet',
    ])
  })

  it('caps --parallel at MAX_PARALLEL', () => {
    expect(parseMeasureArgs('--parallel 99').parallel).toBe(MAX_PARALLEL)
  })

  it('parses --timeout in seconds', () => {
    expect(parseMeasureArgs('--timeout 30').timeoutMs).toBe(30_000)
  })

  it('sets list when --list is present', () => {
    expect(parseMeasureArgs('--list').list).toBe(true)
    expect(parseMeasureArgs('-l').list).toBe(true)
    expect(parseMeasureArgs('').list).toBe(false)
  })

  it('handles combined flags', () => {
    const out = parseMeasureArgs(
      '-n 3 --tools void,claude --models opus --parallel 4 --timeout 45',
    )
    expect(out.n).toBe(3)
    expect(out.tools).toEqual(['void', 'claude'])
    expect(out.models).toEqual(['opus'])
    expect(out.parallel).toBe(4)
    expect(out.timeoutMs).toBe(45_000)
  })
})

describe('buildVariants', () => {
  it('emits one variant per detected tool when no models given', () => {
    const variants = buildVariants([VOID_TOOL, CLAUDE_TOOL, CODEX_TOOL], [])
    expect(variants.map(v => v.id)).toEqual(['void', 'claude', 'codex'])
  })

  it('adds void@<model> variants for each --models entry', () => {
    const variants = buildVariants(
      [VOID_TOOL, CLAUDE_TOOL],
      ['opus', 'sonnet'],
    )
    expect(variants.map(v => v.id)).toEqual([
      'void',
      'void@opus',
      'void@sonnet',
      'claude',
    ])
  })

  it('does not apply --models to non-void tools', () => {
    const variants = buildVariants([CLAUDE_TOOL, CODEX_TOOL], ['opus', 'sonnet'])
    expect(variants.map(v => v.id)).toEqual(['claude', 'codex'])
  })

  it('preserves binary and version on every variant', () => {
    const variants = buildVariants([VOID_TOOL], ['opus'])
    for (const v of variants) {
      expect(v.binary).toBe(VOID_TOOL.binary)
      expect(v.version).toBe(VOID_TOOL.version)
    }
    expect(variants[0]!.model).toBeUndefined()
    expect(variants[1]!.model).toBe('opus')
  })

  it('returns empty when no tools detected', () => {
    expect(buildVariants([], ['opus'])).toEqual([])
  })
})

describe('buildMeasureOptions', () => {
  const ctx = { cwd: '/Users/me/proj', home: '/Users/me' }

  it('routes paths through ctx.home', () => {
    const variants = buildVariants([VOID_TOOL], [])
    const o = buildMeasureOptions(parseMeasureArgs(''), variants, ctx)
    expect(o.historyPath).toBe('/Users/me/.void/history.jsonl')
    expect(o.vaultDir).toBe('/Users/me/vault/measurements')
  })

  it('passes through parsed n, parallel, timeout', () => {
    const variants = buildVariants([VOID_TOOL], [])
    const o = buildMeasureOptions(
      parseMeasureArgs('-n 4 --parallel 2 --timeout 120'),
      variants,
      ctx,
    )
    expect(o.n).toBe(4)
    expect(o.parallel).toBe(2)
    expect(o.timeoutMs).toBe(120_000)
  })

  it('uses cwd as projectPath', () => {
    const variants = buildVariants([VOID_TOOL], [])
    const o = buildMeasureOptions(parseMeasureArgs(''), variants, ctx)
    expect(o.projectPath).toBe('/Users/me/proj')
  })

  it('carries the variant list through unchanged', () => {
    const variants = buildVariants([VOID_TOOL, CLAUDE_TOOL], ['opus'])
    const o = buildMeasureOptions(parseMeasureArgs(''), variants, ctx)
    expect(o.variants.map(v => v.id)).toEqual(['void', 'void@opus', 'claude'])
  })
})

describe('formatDetectedTools', () => {
  it('emits a friendly summary of detected + missing', () => {
    const text = formatDetectedTools([VOID_TOOL, CLAUDE_TOOL], ['opencode'])
    expect(text).toContain('Detected tools:')
    expect(text).toContain('void: 2.1.94 (Void)')
    expect(text).toContain('claude: 2.1.119 (Claude Code)')
    expect(text).toContain('Requested but not installed:')
    expect(text).toContain('opencode')
  })

  it('reports no detection when the list is empty', () => {
    const text = formatDetectedTools([], [])
    expect(text).toContain('No tools detected.')
  })
})
