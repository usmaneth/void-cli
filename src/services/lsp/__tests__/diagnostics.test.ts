/**
 * Tests for the LSP diagnostic aggregator cache and event bus.
 *
 * These are pure unit tests — no LSP server, no watcher, no filesystem.
 * They exercise the aggregator contract that consumers (SessionHUD,
 * tool-result injection) depend on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// VOID_LSP_SERVER must be set *before* the module under test is imported,
// because isLspServerEnabled() is read at module import time for some paths.
// We set it in beforeEach via process.env and dynamically import.
let mod: typeof import('../diagnostics.js')

describe('LSP diagnostic aggregator', () => {
  beforeEach(async () => {
    process.env.VOID_LSP_SERVER = '1'
    vi.resetModules()
    mod = await import('../diagnostics.js')
    mod.resetDiagnosticsCache()
  })

  afterEach(() => {
    mod.resetDiagnosticsCache()
  })

  it('returns empty diagnostics for an unknown file', () => {
    expect(mod.getDiagnostics('/tmp/unknown.ts')).toEqual([])
  })

  it('upsertDiagnostics stores and retrieves by fs path or uri', () => {
    mod.upsertDiagnostics('/tmp/foo.ts', [
      {
        message: 'oops',
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ])

    expect(mod.getDiagnostics('/tmp/foo.ts')).toHaveLength(1)
    // Same path passed as file:// URI should resolve to the same entry
    expect(mod.getDiagnostics('file:///tmp/foo.ts')).toHaveLength(1)
  })

  it('emits lsp.diagnostics.changed on upsert', () => {
    const bus = mod.getDiagnosticsBus()
    const calls: Array<{ path: string; version: number }> = []
    const handler = (e: { path: string; version: number }): void => {
      calls.push({ path: e.path, version: e.version })
    }
    bus.on(mod.LSP_DIAGNOSTICS_CHANGED, handler)

    mod.upsertDiagnostics('/tmp/bar.ts', [
      {
        message: 'x',
        severity: 'Warning',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 2 },
        },
      },
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/tmp/bar.ts')
    expect(calls[0]?.version).toBe(1)
    bus.off(mod.LSP_DIAGNOSTICS_CHANGED, handler)
  })

  it('does not re-emit when the diagnostic list is unchanged', () => {
    const bus = mod.getDiagnosticsBus()
    let count = 0
    const handler = (): void => {
      count++
    }
    bus.on(mod.LSP_DIAGNOSTICS_CHANGED, handler)

    const list = [
      {
        message: 'same',
        severity: 'Error' as const,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ]
    mod.upsertDiagnostics('/tmp/baz.ts', list)
    mod.upsertDiagnostics('/tmp/baz.ts', list)
    expect(count).toBe(1)

    bus.off(mod.LSP_DIAGNOSTICS_CHANGED, handler)
  })

  it('getCounts rolls up severities across files', () => {
    mod.upsertDiagnostics('/a.ts', [
      {
        message: 'e1',
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
      {
        message: 'w1',
        severity: 'Warning',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 },
        },
      },
    ])
    mod.upsertDiagnostics('/b.ts', [
      {
        message: 'e2',
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
      {
        message: 'h1',
        severity: 'Hint',
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 1 },
        },
      },
    ])

    const counts = mod.getCounts()
    expect(counts.errors).toBe(2)
    expect(counts.warnings).toBe(1)
    expect(counts.info).toBe(0)
    expect(counts.hints).toBe(1)
  })

  it('clearDiagnosticsForFile removes entries and emits change', () => {
    mod.upsertDiagnostics('/c.ts', [
      {
        message: 'e',
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ])
    expect(mod.getCounts().errors).toBe(1)
    mod.clearDiagnosticsForFile('/c.ts')
    expect(mod.getCounts().errors).toBe(0)
    expect(mod.getDiagnostics('/c.ts')).toEqual([])
  })

  it('subscribe callbacks receive events and can unsubscribe', () => {
    const received: number[] = []
    const unsubscribe = mod.subscribe(e => {
      received.push(e.diagnostics.length)
    })

    mod.upsertDiagnostics('/d.ts', [
      {
        message: 'e',
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ])
    unsubscribe()
    mod.upsertDiagnostics('/d.ts', [])
    expect(received).toEqual([1])
  })

  it('formatDiagnosticsForToolResult renders errors before warnings', () => {
    mod.upsertDiagnostics('/e.ts', [
      {
        message: 'unused',
        severity: 'Warning',
        range: {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 4 },
        },
      },
      {
        message: 'bad type',
        severity: 'Error',
        range: {
          start: { line: 10, character: 2 },
          end: { line: 10, character: 5 },
        },
      },
    ])
    const out = mod.formatDiagnosticsForToolResult('/e.ts')
    expect(out).toContain('1 error')
    expect(out).toContain('1 warning')
    expect(out.indexOf('E:')).toBeLessThan(out.indexOf('W:'))
  })

  it('formatDiagnosticsForToolResult caps items with "… and N more"', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      message: `m${i}`,
      severity: 'Error' as const,
      range: {
        start: { line: i, character: 0 },
        end: { line: i, character: 1 },
      },
    }))
    mod.upsertDiagnostics('/many.ts', many)
    const out = mod.formatDiagnosticsForToolResult('/many.ts', { maxItems: 3 })
    expect(out).toContain('… and 7 more')
  })
})
