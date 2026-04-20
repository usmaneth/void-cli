/**
 * LSP Diagnostic Overlay
 *
 * Pure-function helpers that turn a list of LspDiagnostic objects into an
 * overlay that can be rendered on top of (or beside) a diff hunk in the TUI.
 *
 * This module is *entirely UI-agnostic*. It does not import React or Ink and
 * therefore trivially unit-tests in any Node environment. Components (ink TSX
 * or otherwise) consume the shape returned by `buildOverlay()`.
 *
 * The overlay is gated behind the `VOID_INLINE_DIAGNOSTICS=1` feature flag.
 * When the flag is off every public entry point falls through cleanly:
 *
 *   - `isInlineDiagnosticsEnabled()` → false
 *   - `buildOverlay()`               → empty overlay
 *   - `renderOverlayLines()`         → []
 *
 * Terminal-width awareness:
 *   - When `columns >= 80` the overlay renders severity + message inline.
 *   - When `columns <  80` the overlay collapses to a one-char severity
 *     badge (`E`, `W`, `I`, `H`) only. This keeps narrow terminals readable.
 */

import type { LspDiagnostic } from './diagnostics.js'

/** Feature flag env var — independent from `VOID_LSP_SERVER`. */
export const VOID_INLINE_DIAGNOSTICS_ENV = 'VOID_INLINE_DIAGNOSTICS'

/** Minimum terminal width before we start collapsing messages to badges. */
export const NARROW_TERMINAL_THRESHOLD = 80

/**
 * A rendered overlay line, keyed by the 1-indexed source line number it
 * annotates. Consumers that draw diffs can look up `overlay.byLine.get(lineNo)`
 * while iterating hunks.
 */
export type DiagnosticOverlayLine = {
  /** 1-indexed line number in the *new* file (post-edit). */
  line: number
  /** Highest-priority severity attached to this line. */
  severity: LspDiagnostic['severity']
  /** One-character badge: 'E' | 'W' | 'I' | 'H'. */
  badge: string
  /** ANSI color role: 'red' | 'yellow' | 'blue' | 'gray'. */
  color: OverlayColor
  /** All diagnostics for this line, severity-ordered (errors first). */
  diagnostics: LspDiagnostic[]
  /** Short single-line prefix like "✗ error: " — useful as inline marker. */
  prefix: string
  /** Primary message (first diagnostic's message, single-lined). */
  message: string
  /** How many additional diagnostics are collapsed on this line. */
  extraCount: number
}

export type OverlayColor = 'red' | 'yellow' | 'blue' | 'gray'

export type DiagnosticOverlay = {
  /** Map from 1-indexed line number to overlay data. */
  byLine: Map<number, DiagnosticOverlayLine>
  /** Severity-ordered flat list (useful for summary renderers). */
  ordered: DiagnosticOverlayLine[]
  /** Terminal-narrow mode decided when building the overlay. */
  narrow: boolean
  /** True when the feature flag was off — consumers can skip rendering. */
  disabled: boolean
}

export type BuildOverlayOptions = {
  /** Terminal columns; anything < 80 triggers badge-only mode. */
  columns?: number
  /** Override the env-flag check (useful in tests). */
  enabled?: boolean
  /** Cap on line count (avoid massive overlays on files with 1000 errors). */
  maxLines?: number
}

/** Returns true when VOID_INLINE_DIAGNOSTICS is set to a truthy value. */
export function isInlineDiagnosticsEnabled(): boolean {
  const v = process.env[VOID_INLINE_DIAGNOSTICS_ENV]
  return v === '1' || v === 'true' || v === 'yes'
}

const EMPTY_OVERLAY: DiagnosticOverlay = {
  byLine: new Map(),
  ordered: [],
  narrow: false,
  disabled: true,
}

/**
 * Construct an overlay from a list of diagnostics. The input is the raw cache
 * output from `getDiagnostics(path)`; this function groups by line, picks the
 * strongest severity per line, sorts errors first, and applies narrow-mode
 * collapsing when appropriate.
 *
 * Returns an `EMPTY_OVERLAY` (with `disabled: true`) when the feature flag is
 * off *and* the caller didn't explicitly pass `enabled: true`.
 */
export function buildOverlay(
  diagnostics: readonly LspDiagnostic[] | null | undefined,
  options: BuildOverlayOptions = {},
): DiagnosticOverlay {
  const enabled = options.enabled ?? isInlineDiagnosticsEnabled()
  if (!enabled) return EMPTY_OVERLAY
  if (!diagnostics || diagnostics.length === 0) {
    return {
      byLine: new Map(),
      ordered: [],
      narrow: (options.columns ?? 80) < NARROW_TERMINAL_THRESHOLD,
      disabled: false,
    }
  }

  const narrow = (options.columns ?? 80) < NARROW_TERMINAL_THRESHOLD

  // Group by 1-indexed line (LSP is 0-indexed; editors and diff gutters are 1-indexed).
  const byLine = new Map<number, LspDiagnostic[]>()
  for (const d of diagnostics) {
    const line = (d.range?.start?.line ?? 0) + 1
    const bucket = byLine.get(line)
    if (bucket) bucket.push(d)
    else byLine.set(line, [d])
  }

  const ordered: DiagnosticOverlayLine[] = []
  for (const [line, list] of byLine.entries()) {
    list.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    const head = list[0]!
    ordered.push({
      line,
      severity: head.severity,
      badge: severityBadge(head.severity),
      color: severityColor(head.severity),
      diagnostics: list,
      prefix: narrow ? severityBadge(head.severity) : severityPrefix(head.severity),
      message: narrow ? '' : firstMessageLine(head.message),
      extraCount: Math.max(0, list.length - 1),
    })
  }

  // Errors first, then by line for stability.
  ordered.sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity)
    if (r !== 0) return r
    return a.line - b.line
  })

  // Cap. Errors are first in `ordered`, so truncation drops hints/info first.
  const capped =
    typeof options.maxLines === 'number' && options.maxLines >= 0
      ? ordered.slice(0, options.maxLines)
      : ordered

  // Rebuild byLine from the (potentially capped) ordered list so UI lookups
  // and byLine.size stay in sync with `ordered.length`.
  const outByLine = new Map<number, DiagnosticOverlayLine>()
  for (const o of capped) outByLine.set(o.line, o)

  return {
    byLine: outByLine,
    ordered: capped,
    narrow,
    disabled: false,
  }
}

/**
 * Render the overlay as plain text lines. Useful for terminals without
 * ANSI color, snapshot-testing, and the session-history "diagnostics not
 * recorded" fallback surface.
 *
 * Output example (wide terminal):
 *   L12  ✗ error: Type 'string' is not assignable to type 'number'.
 *   L88  ⚠ warning: 'foo' is declared but never used.
 *
 * Narrow terminal (< 80 cols):
 *   L12 E
 *   L88 W
 */
export function renderOverlayLines(overlay: DiagnosticOverlay): string[] {
  if (overlay.disabled) return []
  const out: string[] = []
  for (const o of overlay.ordered) {
    const lineNo = `L${o.line}`.padEnd(6)
    if (overlay.narrow) {
      out.push(`${lineNo}${o.badge}`)
    } else {
      const extra = o.extraCount > 0 ? ` (+${o.extraCount} more)` : ''
      out.push(`${lineNo}${o.prefix}${o.message}${extra}`)
    }
  }
  return out
}

/**
 * Render a trailing-badge summary string suitable for showing next to a diff
 * header, e.g. `[3E 1W]`. Returns '' when the overlay is empty or disabled.
 */
export function renderOverlayBadge(overlay: DiagnosticOverlay): string {
  if (overlay.disabled) return ''
  let e = 0
  let w = 0
  let i = 0
  let h = 0
  for (const o of overlay.ordered) {
    for (const d of o.diagnostics) {
      if (d.severity === 'Error') e++
      else if (d.severity === 'Warning') w++
      else if (d.severity === 'Info') i++
      else h++
    }
  }
  if (e + w + i + h === 0) return ''
  const parts: string[] = []
  if (e > 0) parts.push(`${e}E`)
  if (w > 0) parts.push(`${w}W`)
  if (i > 0) parts.push(`${i}I`)
  if (h > 0) parts.push(`${h}H`)
  return `[${parts.join(' ')}]`
}

/**
 * Produce a before/after delta — useful for permission prompts that want to
 * say "if you apply this edit, +3 new errors will appear".
 *
 * `before` and `after` should be overlays built from the same file at two
 * points in time (typically: current cache vs temp-file probe).
 */
export type DiagnosticDelta = {
  newErrors: number
  newWarnings: number
  fixedErrors: number
  fixedWarnings: number
  /** Human-friendly one-liner; '' when nothing changed. */
  summary: string
}

export function computeDelta(
  before: DiagnosticOverlay,
  after: DiagnosticOverlay,
): DiagnosticDelta {
  const b = countBySeverity(before)
  const a = countBySeverity(after)
  const newErrors = Math.max(0, a.errors - b.errors)
  const newWarnings = Math.max(0, a.warnings - b.warnings)
  const fixedErrors = Math.max(0, b.errors - a.errors)
  const fixedWarnings = Math.max(0, b.warnings - a.warnings)

  const bits: string[] = []
  if (newErrors > 0) bits.push(`+${newErrors} error${newErrors === 1 ? '' : 's'}`)
  if (newWarnings > 0)
    bits.push(`+${newWarnings} warning${newWarnings === 1 ? '' : 's'}`)
  if (fixedErrors > 0)
    bits.push(`-${fixedErrors} error${fixedErrors === 1 ? '' : 's'}`)
  if (fixedWarnings > 0)
    bits.push(`-${fixedWarnings} warning${fixedWarnings === 1 ? '' : 's'}`)
  return {
    newErrors,
    newWarnings,
    fixedErrors,
    fixedWarnings,
    summary: bits.join(', '),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityRank(s: LspDiagnostic['severity']): number {
  switch (s) {
    case 'Error':
      return 1
    case 'Warning':
      return 2
    case 'Info':
      return 3
    case 'Hint':
      return 4
  }
}

function severityBadge(s: LspDiagnostic['severity']): string {
  switch (s) {
    case 'Error':
      return 'E'
    case 'Warning':
      return 'W'
    case 'Info':
      return 'I'
    case 'Hint':
      return 'H'
  }
}

function severityPrefix(s: LspDiagnostic['severity']): string {
  switch (s) {
    case 'Error':
      return '✗ error: '
    case 'Warning':
      return '⚠ warning: '
    case 'Info':
      return 'ℹ info: '
    case 'Hint':
      return '· hint: '
  }
}

function severityColor(s: LspDiagnostic['severity']): OverlayColor {
  switch (s) {
    case 'Error':
      return 'red'
    case 'Warning':
      return 'yellow'
    case 'Info':
      return 'blue'
    case 'Hint':
      return 'gray'
  }
}

function firstMessageLine(msg: string): string {
  return (msg.split('\n')[0] ?? msg).trim()
}

function countBySeverity(o: DiagnosticOverlay): {
  errors: number
  warnings: number
} {
  let errors = 0
  let warnings = 0
  if (o.disabled) return { errors, warnings }
  for (const ol of o.ordered) {
    for (const d of ol.diagnostics) {
      if (d.severity === 'Error') errors++
      else if (d.severity === 'Warning') warnings++
    }
  }
  return { errors, warnings }
}
