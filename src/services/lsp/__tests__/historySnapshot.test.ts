/**
 * historySnapshot.ts tests
 *
 * - capture is a no-op when the flag is off
 * - capture stores a deep-copy so later cache mutations don't alter the
 *   snapshot
 * - getSnapshot returns null when missing
 * - resetSnapshots clears everything
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resetDiagnosticsCache,
  upsertDiagnostics,
  type LspDiagnostic,
} from '../diagnostics.js'
import { VOID_INLINE_DIAGNOSTICS_ENV } from '../overlay.js'
import {
  _snapshotCount,
  captureDiagnosticsSnapshot,
  getSnapshot,
  hasSnapshot,
  resetSnapshots,
} from '../historySnapshot.js'

function diag(line: number, sev: LspDiagnostic['severity']): LspDiagnostic {
  return {
    message: 'm',
    severity: sev,
    range: {
      start: { line: line - 1, character: 0 },
      end: { line: line - 1, character: 1 },
    },
  }
}

describe('historySnapshot', () => {
  const saved = process.env[VOID_INLINE_DIAGNOSTICS_ENV]

  beforeEach(() => {
    process.env[VOID_INLINE_DIAGNOSTICS_ENV] = '1'
    resetSnapshots()
    resetDiagnosticsCache()
  })

  afterEach(() => {
    if (saved === undefined) delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
    else process.env[VOID_INLINE_DIAGNOSTICS_ENV] = saved
    resetSnapshots()
    resetDiagnosticsCache()
  })

  it('captures a snapshot of the current cache under a key', () => {
    upsertDiagnostics('/tmp/a.ts', [diag(1, 'Error')])
    const snap = captureDiagnosticsSnapshot('tool-abc', '/tmp/a.ts')
    expect(snap).not.toBeNull()
    expect(snap!.diagnostics).toHaveLength(1)
    expect(snap!.path).toBe('/tmp/a.ts')
    expect(hasSnapshot('tool-abc')).toBe(true)
    expect(_snapshotCount()).toBe(1)
  })

  it('snapshot is a deep copy — mutating the cache later does not change it', () => {
    upsertDiagnostics('/tmp/a.ts', [diag(1, 'Error')])
    captureDiagnosticsSnapshot('tool-1', '/tmp/a.ts')

    // Add a new diagnostic to the live cache.
    upsertDiagnostics('/tmp/a.ts', [diag(1, 'Error'), diag(2, 'Warning')])

    const snap = getSnapshot('tool-1')
    expect(snap!.diagnostics).toHaveLength(1)
    expect(snap!.diagnostics[0]!.severity).toBe('Error')
  })

  it('returns null for a missing key', () => {
    expect(getSnapshot('never-captured')).toBeNull()
    expect(hasSnapshot('never-captured')).toBe(false)
  })

  it('captureDiagnosticsSnapshot is a no-op when the flag is off', () => {
    delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
    upsertDiagnostics('/tmp/a.ts', [diag(1, 'Error')])
    const snap = captureDiagnosticsSnapshot('tool-off', '/tmp/a.ts')
    expect(snap).toBeNull()
    expect(hasSnapshot('tool-off')).toBe(false)
  })

  it('resetSnapshots clears everything', () => {
    captureDiagnosticsSnapshot('k', '/tmp/a.ts')
    resetSnapshots()
    expect(_snapshotCount()).toBe(0)
    expect(getSnapshot('k')).toBeNull()
  })
})
