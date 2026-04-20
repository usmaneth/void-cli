/**
 * toolIntegration tests — prove that:
 *   - appendDiagnosticsToResult is a no-op when the flag is off
 *   - appendDiagnosticsToResult appends a formatted block when diagnostics
 *     exist for the file
 *   - waitForDiagnosticUpdate resolves on event, and on timeout
 *
 * These are pure-logic tests; no real LSP server is spawned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let diag: typeof import('../diagnostics.js')
let tool: typeof import('../toolIntegration.js')

describe('LSP toolIntegration', () => {
  beforeEach(async () => {
    process.env.VOID_LSP_SERVER = '1'
    vi.resetModules()
    diag = await import('../diagnostics.js')
    tool = await import('../toolIntegration.js')
    diag.resetDiagnosticsCache()
  })

  afterEach(() => {
    diag.resetDiagnosticsCache()
  })

  it('appendDiagnosticsToResult is a no-op when flag is off', async () => {
    delete process.env.VOID_LSP_SERVER
    vi.resetModules()
    const freshTool = await import('../toolIntegration.js')
    const freshDiag = await import('../diagnostics.js')
    freshDiag.upsertDiagnostics('/tmp/z.ts', [
      {
        message: 'x',
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
      },
    ])
    // Even with diagnostics present, output must be the original string
    expect(freshTool.appendDiagnosticsToResult('ok', '/tmp/z.ts')).toBe('ok')
  })

  it('appendDiagnosticsToResult appends a block when diagnostics exist', () => {
    diag.upsertDiagnostics('/tmp/y.ts', [
      {
        message: 'bad type',
        severity: 'Error',
        range: {
          start: { line: 3, character: 4 },
          end: { line: 3, character: 8 },
        },
      },
    ])
    const out = tool.appendDiagnosticsToResult('File updated.', '/tmp/y.ts')
    expect(out.startsWith('File updated.')).toBe(true)
    expect(out).toContain('LSP (1 error)')
    expect(out).toContain('bad type')
  })

  it('appendDiagnosticsToResult returns unchanged when file has no diagnostics', () => {
    const out = tool.appendDiagnosticsToResult('ok', '/tmp/clean.ts')
    expect(out).toBe('ok')
  })

  it('waitForDiagnosticUpdate resolves on event', async () => {
    const p = tool.waitForDiagnosticUpdate('/tmp/event.ts', 2000)
    setTimeout(() => {
      diag.upsertDiagnostics('/tmp/event.ts', [
        {
          message: 'e',
          severity: 'Error',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ])
    }, 30)
    await p
    // If we got here, it resolved — otherwise the await would time out the test
    expect(diag.getDiagnostics('/tmp/event.ts')).toHaveLength(1)
  })

  it('waitForDiagnosticUpdate resolves on timeout', async () => {
    const start = Date.now()
    await tool.waitForDiagnosticUpdate('/tmp/never.ts', 120)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(elapsed).toBeLessThan(1000)
  })
})
