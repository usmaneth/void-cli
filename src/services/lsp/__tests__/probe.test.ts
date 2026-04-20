/**
 * probe.ts tests
 *
 * Proves the temp-file LSP probe:
 *   - No-ops cleanly when VOID_INLINE_DIAGNOSTICS is off.
 *   - Writes a temp file, asks the (injected) LSP, reads diagnostics, and
 *     cleans the temp file afterwards — even if the LSP never replies.
 *   - Computes a delta vs the pre-edit cache.
 *   - Never leaks temp files on success, timeout, OR error.
 *
 * A fake LSP is injected via `openAndChange` / `readDiagnostics` so no real
 * language server is required.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LspDiagnostic } from '../diagnostics.js'
import { VOID_INLINE_DIAGNOSTICS_ENV } from '../overlay.js'
import {
  _clearTempFileTracking,
  _leakedTempFileCount,
  probeDiagnosticsForProposedContent,
} from '../probe.js'

function makeDiag(line: number, sev: LspDiagnostic['severity']): LspDiagnostic {
  return {
    message: `${sev} @ ${line}`,
    severity: sev,
    range: {
      start: { line: line - 1, character: 0 },
      end: { line: line - 1, character: 1 },
    },
  }
}

describe('probe / feature flag', () => {
  const saved = process.env[VOID_INLINE_DIAGNOSTICS_ENV]
  beforeEach(() => {
    delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
    _clearTempFileTracking()
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
    else process.env[VOID_INLINE_DIAGNOSTICS_ENV] = saved
  })

  it('returns empty overlay and probed:false when flag is off', async () => {
    const result = await probeDiagnosticsForProposedContent(
      '/tmp/fake.ts',
      'const x = 1',
    )
    expect(result.probed).toBe(false)
    expect(result.overlay.disabled).toBe(true)
    expect(result.tempPath).toBeNull()
    expect(result.delta.newErrors).toBe(0)
  })
})

describe('probe / temp-file lifecycle', () => {
  let probeDir: string

  beforeEach(() => {
    process.env[VOID_INLINE_DIAGNOSTICS_ENV] = '1'
    _clearTempFileTracking()
    probeDir = mkdtempSync(join(tmpdir(), 'void-probe-test-'))
  })

  afterEach(() => {
    delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
    _clearTempFileTracking()
    try {
      rmSync(probeDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('writes a temp file and cleans it up on success', async () => {
    let observedTempPath: string | null = null
    let openCalled = false

    const fakeDiagnostics = new Map<string, LspDiagnostic[]>()

    const result = await probeDiagnosticsForProposedContent(
      '/tmp/orig.ts',
      'const x: number = "oops"',
      {
        enabled: true,
        tmpDir: probeDir,
        timeoutMs: 500,
        openAndChange: async (p, _c) => {
          openCalled = true
          observedTempPath = p
          // Simulate server returning one error.
          fakeDiagnostics.set(p, [makeDiag(1, 'Error')])
        },
        readDiagnostics: p => fakeDiagnostics.get(p) ?? [],
      },
    )

    expect(openCalled).toBe(true)
    expect(observedTempPath).not.toBeNull()
    expect(result.probed).toBe(true)
    expect(result.overlay.ordered).toHaveLength(1)
    expect(result.overlay.ordered[0]!.severity).toBe('Error')

    // Temp file must NOT still exist.
    expect(existsSync(observedTempPath!)).toBe(false)
    expect(_leakedTempFileCount()).toBe(0)
    // Directory must be empty (apart from dotfiles).
    const remaining = readdirSync(probeDir).filter(f => !f.startsWith('.'))
    expect(remaining).toEqual([])
  })

  it('preserves the original extension so LSP server can route it', async () => {
    let observedTempPath = ''
    await probeDiagnosticsForProposedContent(
      '/some/dir/myfile.py',
      'print(1)',
      {
        enabled: true,
        tmpDir: probeDir,
        timeoutMs: 200,
        openAndChange: async p => {
          observedTempPath = p
        },
        readDiagnostics: () => [],
      },
    )
    expect(observedTempPath.endsWith('.py')).toBe(true)
  })

  it('does not leak temp files on timeout (LSP never replies)', async () => {
    let observedTempPath: string | null = null
    const result = await probeDiagnosticsForProposedContent(
      '/tmp/orig.ts',
      'const x = 1',
      {
        enabled: true,
        tmpDir: probeDir,
        timeoutMs: 200,
        openAndChange: async p => {
          observedTempPath = p
          // Deliberately do NOT populate fakeDiagnostics.
        },
        readDiagnostics: () => [],
      },
    )
    expect(result.probed).toBe(true)
    expect(result.overlay.ordered).toHaveLength(0)
    expect(observedTempPath).not.toBeNull()
    expect(existsSync(observedTempPath!)).toBe(false)
    expect(_leakedTempFileCount()).toBe(0)
  })

  it('does not leak temp files when openAndChange throws', async () => {
    let observedTempPath: string | null = null
    const result = await probeDiagnosticsForProposedContent(
      '/tmp/orig.ts',
      'const x = 1',
      {
        enabled: true,
        tmpDir: probeDir,
        timeoutMs: 200,
        openAndChange: async p => {
          observedTempPath = p
          throw new Error('simulated LSP failure')
        },
        readDiagnostics: () => [],
      },
    )
    // probe() swallows the LSP error and still returns a usable result.
    expect(observedTempPath).not.toBeNull()
    expect(existsSync(observedTempPath!)).toBe(false)
    expect(_leakedTempFileCount()).toBe(0)
    // When the LSP throws, no post-edit diagnostics to show.
    expect(result.overlay.ordered).toHaveLength(0)
  })

  it('computes a delta vs the pre-edit cache', async () => {
    const fakeCache = new Map<string, LspDiagnostic[]>()
    // Pre-edit: one warning on the real file.
    fakeCache.set('/tmp/orig.ts', [makeDiag(2, 'Warning')])

    const result = await probeDiagnosticsForProposedContent(
      '/tmp/orig.ts',
      'new content',
      {
        enabled: true,
        tmpDir: probeDir,
        timeoutMs: 300,
        openAndChange: async p => {
          // Post-edit: warning gone, new error introduced.
          fakeCache.set(p, [makeDiag(3, 'Error')])
        },
        readDiagnostics: p => fakeCache.get(p) ?? [],
      },
    )

    expect(result.probed).toBe(true)
    expect(result.delta.newErrors).toBe(1)
    expect(result.delta.fixedWarnings).toBe(1)
    expect(result.delta.summary).toContain('+1 error')
    expect(result.delta.summary).toContain('-1 warning')
  })
})
