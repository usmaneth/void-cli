/**
 * overlay.ts tests
 *
 * These are pure-function tests — no LSP, no filesystem, no event bus.
 * They cover:
 *   - Feature flag off: builder returns empty / disabled overlay
 *   - Rendering of a basic overlay (snapshot of output lines)
 *   - Multiple diagnostics collapsed onto one line
 *   - Severity ordering: errors sort before warnings before info before hints
 *   - Narrow-terminal mode collapses messages to single-char badges
 *   - Missing / empty diagnostic input handled gracefully
 *   - `computeDelta()` classifies "new" vs "fixed" correctly
 *   - `renderOverlayBadge()` summary string
 *   - Capping via `maxLines` retains errors first
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LspDiagnostic } from '../diagnostics.js'
import {
  buildOverlay,
  computeDelta,
  isInlineDiagnosticsEnabled,
  renderOverlayBadge,
  renderOverlayLines,
  VOID_INLINE_DIAGNOSTICS_ENV,
} from '../overlay.js'

function diag(
  line: number,
  severity: LspDiagnostic['severity'],
  message: string,
  col = 0,
): LspDiagnostic {
  return {
    message,
    severity,
    range: {
      start: { line: line - 1, character: col },
      end: { line: line - 1, character: col + 1 },
    },
  }
}

describe('overlay / feature flag', () => {
  const savedEnv = process.env[VOID_INLINE_DIAGNOSTICS_ENV]

  beforeEach(() => {
    delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
  })

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[VOID_INLINE_DIAGNOSTICS_ENV]
    } else {
      process.env[VOID_INLINE_DIAGNOSTICS_ENV] = savedEnv
    }
  })

  it('isInlineDiagnosticsEnabled reflects env', () => {
    expect(isInlineDiagnosticsEnabled()).toBe(false)
    process.env[VOID_INLINE_DIAGNOSTICS_ENV] = '1'
    expect(isInlineDiagnosticsEnabled()).toBe(true)
    process.env[VOID_INLINE_DIAGNOSTICS_ENV] = 'true'
    expect(isInlineDiagnosticsEnabled()).toBe(true)
    process.env[VOID_INLINE_DIAGNOSTICS_ENV] = '0'
    expect(isInlineDiagnosticsEnabled()).toBe(false)
  })

  it('buildOverlay returns disabled empty overlay when flag is off', () => {
    const o = buildOverlay([diag(3, 'Error', 'oops')])
    expect(o.disabled).toBe(true)
    expect(o.ordered).toHaveLength(0)
    expect(o.byLine.size).toBe(0)
  })

  it('renderOverlayLines is [] when overlay is disabled', () => {
    const o = buildOverlay([diag(3, 'Error', 'oops')])
    expect(renderOverlayLines(o)).toEqual([])
  })

  it('renderOverlayBadge is "" when overlay is disabled', () => {
    const o = buildOverlay([diag(3, 'Error', 'oops')])
    expect(renderOverlayBadge(o)).toBe('')
  })
})

describe('overlay / basic rendering (flag on)', () => {
  it('renders a single diagnostic with a prefix (snapshot-style)', () => {
    const overlay = buildOverlay(
      [diag(12, 'Error', "Type 'string' is not assignable to type 'number'.")],
      { enabled: true, columns: 120 },
    )
    const lines = renderOverlayLines(overlay)
    expect(lines).toEqual([
      `L12   ✗ error: Type 'string' is not assignable to type 'number'.`,
    ])
    expect(overlay.disabled).toBe(false)
    expect(overlay.narrow).toBe(false)
    expect(overlay.byLine.get(12)?.color).toBe('red')
  })

  it('maps severity → color correctly for every severity level', () => {
    const o = buildOverlay(
      [
        diag(1, 'Error', 'e'),
        diag(2, 'Warning', 'w'),
        diag(3, 'Info', 'i'),
        diag(4, 'Hint', 'h'),
      ],
      { enabled: true, columns: 120 },
    )
    expect(o.byLine.get(1)?.color).toBe('red')
    expect(o.byLine.get(2)?.color).toBe('yellow')
    expect(o.byLine.get(3)?.color).toBe('blue')
    expect(o.byLine.get(4)?.color).toBe('gray')
  })

  it('renders an empty-but-enabled overlay with no lines', () => {
    const o = buildOverlay([], { enabled: true, columns: 120 })
    expect(o.disabled).toBe(false)
    expect(o.ordered).toHaveLength(0)
    expect(renderOverlayLines(o)).toEqual([])
    expect(renderOverlayBadge(o)).toBe('')
  })

  it('handles null/undefined input without throwing', () => {
    expect(() => buildOverlay(null, { enabled: true })).not.toThrow()
    expect(() => buildOverlay(undefined, { enabled: true })).not.toThrow()
    const o = buildOverlay(null, { enabled: true, columns: 120 })
    expect(o.ordered).toHaveLength(0)
    expect(o.disabled).toBe(false)
  })
})

describe('overlay / multi-diagnostic grouping', () => {
  it('collapses multiple diagnostics on the same line and reports extraCount', () => {
    const overlay = buildOverlay(
      [
        diag(5, 'Warning', 'unused var foo'),
        diag(5, 'Error', 'type mismatch'),
        diag(5, 'Info', 'consider renaming'),
      ],
      { enabled: true, columns: 120 },
    )
    expect(overlay.ordered).toHaveLength(1)
    const only = overlay.ordered[0]!
    // Head should be the Error (strongest severity).
    expect(only.severity).toBe('Error')
    expect(only.message).toBe('type mismatch')
    expect(only.extraCount).toBe(2)
    expect(only.diagnostics).toHaveLength(3)
    // Diagnostics within the line are themselves severity-ordered.
    expect(only.diagnostics.map(d => d.severity)).toEqual([
      'Error',
      'Warning',
      'Info',
    ])
  })

  it('renderOverlayLines shows extraCount suffix when > 0', () => {
    const overlay = buildOverlay(
      [diag(5, 'Error', 'A'), diag(5, 'Error', 'B')],
      { enabled: true, columns: 120 },
    )
    const lines = renderOverlayLines(overlay)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('A')
    expect(lines[0]).toContain('(+1 more)')
  })

  it('severity ordering places errors first across distinct lines', () => {
    const overlay = buildOverlay(
      [
        diag(20, 'Hint', 'h1'),
        diag(10, 'Warning', 'w1'),
        diag(30, 'Error', 'e1'),
        diag(5, 'Info', 'i1'),
      ],
      { enabled: true, columns: 120 },
    )
    expect(overlay.ordered.map(o => o.severity)).toEqual([
      'Error',
      'Warning',
      'Info',
      'Hint',
    ])
    // Line order is stable for ties (here every severity is unique).
    expect(overlay.ordered.map(o => o.line)).toEqual([30, 10, 5, 20])
  })
})

describe('overlay / narrow terminal', () => {
  it('uses badge-only format when columns < 80', () => {
    const overlay = buildOverlay(
      [diag(7, 'Error', 'very long error message that would wrap')],
      { enabled: true, columns: 40 },
    )
    expect(overlay.narrow).toBe(true)
    const lines = renderOverlayLines(overlay)
    expect(lines).toEqual([`L7    E`])
    // The ordered entry's `message` field is empty in narrow mode so callers
    // that look at `message` don't accidentally leak long text into tight UI.
    expect(overlay.ordered[0]!.message).toBe('')
    expect(overlay.ordered[0]!.prefix).toBe('E')
  })

  it('stays in wide mode exactly at the threshold (columns === 80)', () => {
    const overlay = buildOverlay(
      [diag(7, 'Error', 'x')],
      { enabled: true, columns: 80 },
    )
    expect(overlay.narrow).toBe(false)
    expect(overlay.ordered[0]!.message).toBe('x')
  })
})

describe('overlay / badges + summary', () => {
  it('renderOverlayBadge summarizes severities', () => {
    const overlay = buildOverlay(
      [
        diag(1, 'Error', 'e1'),
        diag(2, 'Error', 'e2'),
        diag(3, 'Warning', 'w1'),
        diag(4, 'Info', 'i1'),
      ],
      { enabled: true, columns: 120 },
    )
    expect(renderOverlayBadge(overlay)).toBe('[2E 1W 1I]')
  })

  it('renderOverlayBadge returns empty when no diagnostics', () => {
    const o = buildOverlay([], { enabled: true, columns: 120 })
    expect(renderOverlayBadge(o)).toBe('')
  })
})

describe('overlay / computeDelta', () => {
  it('identifies new errors when post-edit has more', () => {
    const before = buildOverlay([diag(1, 'Error', 'e1')], {
      enabled: true,
      columns: 120,
    })
    const after = buildOverlay(
      [diag(1, 'Error', 'e1'), diag(2, 'Error', 'e2'), diag(3, 'Warning', 'w')],
      { enabled: true, columns: 120 },
    )
    const d = computeDelta(before, after)
    expect(d.newErrors).toBe(1)
    expect(d.newWarnings).toBe(1)
    expect(d.fixedErrors).toBe(0)
    expect(d.summary).toBe('+1 error, +1 warning')
  })

  it('identifies fixed errors when post-edit has fewer', () => {
    const before = buildOverlay(
      [diag(1, 'Error', 'e1'), diag(2, 'Error', 'e2')],
      { enabled: true, columns: 120 },
    )
    const after = buildOverlay([], { enabled: true, columns: 120 })
    const d = computeDelta(before, after)
    expect(d.fixedErrors).toBe(2)
    expect(d.newErrors).toBe(0)
    expect(d.summary).toBe('-2 errors')
  })

  it('summary is empty when nothing changed', () => {
    const ov = buildOverlay([diag(1, 'Error', 'same')], {
      enabled: true,
      columns: 120,
    })
    const d = computeDelta(ov, ov)
    expect(d.summary).toBe('')
  })
})

describe('overlay / maxLines cap', () => {
  it('keeps errors ahead of hints when capping', () => {
    const overlay = buildOverlay(
      [
        diag(1, 'Hint', 'h'),
        diag(2, 'Hint', 'h'),
        diag(3, 'Error', 'real problem'),
      ],
      { enabled: true, columns: 120, maxLines: 1 },
    )
    expect(overlay.ordered).toHaveLength(1)
    expect(overlay.ordered[0]!.severity).toBe('Error')
    expect(overlay.byLine.size).toBe(1)
  })
})
