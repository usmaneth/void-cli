/**
 * Tests for the /measure skill's pure parser + options builder. We don't
 * exercise runMeasure here — it spawns subprocesses and writes to disk.
 */
import { describe, expect, it } from 'vitest'
import { buildMeasureOptions, parseMeasureArgs } from '../measure.js'
import { DEFAULT_N, DEFAULT_PARALLEL, DEFAULT_TIMEOUT_MS, MAX_N, MAX_PARALLEL } from '../types.js'

describe('parseMeasureArgs', () => {
  it('returns defaults when given no args', () => {
    expect(parseMeasureArgs('')).toEqual({
      n: DEFAULT_N,
      models: [],
      parallel: DEFAULT_PARALLEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
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

  it('parses --models as comma-separated', () => {
    expect(parseMeasureArgs('--models opus,sonnet,haiku').models).toEqual([
      'opus',
      'sonnet',
      'haiku',
    ])
  })

  it('drops empty entries from --models (e.g. trailing/double commas)', () => {
    // The argument is split on whitespace first, so internal spaces inside
    // the comma list aren't supported — but trailing/double commas should
    // still be cleaned up via the trim+filter inside parseMeasureArgs.
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

  it('handles combined flags', () => {
    const out = parseMeasureArgs('-n 3 --models opus,sonnet --parallel 4 --timeout 45')
    expect(out.n).toBe(3)
    expect(out.models).toEqual(['opus', 'sonnet'])
    expect(out.parallel).toBe(4)
    expect(out.timeoutMs).toBe(45_000)
  })
})

describe('buildMeasureOptions', () => {
  const ctx = { cwd: '/Users/me/proj', home: '/Users/me' }

  it('falls back to "default" model when --models is empty', () => {
    const o = buildMeasureOptions(parseMeasureArgs(''), ctx)
    expect(o.models).toEqual(['default'])
  })

  it('routes paths through ctx.home', () => {
    const o = buildMeasureOptions(parseMeasureArgs(''), ctx)
    expect(o.historyPath).toBe('/Users/me/.void/history.jsonl')
    expect(o.vaultDir).toBe('/Users/me/vault/measurements')
  })

  it('passes through parsed n, models, parallel, timeout', () => {
    const o = buildMeasureOptions(
      parseMeasureArgs('-n 4 --models opus --parallel 2 --timeout 120'),
      ctx,
    )
    expect(o.n).toBe(4)
    expect(o.models).toEqual(['opus'])
    expect(o.parallel).toBe(2)
    expect(o.timeoutMs).toBe(120_000)
  })

  it('uses cwd as projectPath', () => {
    const o = buildMeasureOptions(parseMeasureArgs(''), ctx)
    expect(o.projectPath).toBe('/Users/me/proj')
  })
})
