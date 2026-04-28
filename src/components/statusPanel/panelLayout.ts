/**
 * Resolve StatusPanel rendering mode based on terminal width and user override.
 *
 *   full     — 5-row hero panel (≥ 90 cols)
 *   compact  — 3-row condensed panel (60..89 cols)
 *   minimal  — single-line rail (< 60 cols)
 *   off      — hide panel entirely (override-only)
 *
 * Override beats terminal-size detection. Width 0 (e.g. piped/non-TTY)
 * falls through to minimal.
 */

export type PanelLayoutMode = 'full' | 'compact' | 'minimal' | 'off'
export type PanelLayoutOverride = PanelLayoutMode | undefined

const FULL_THRESHOLD = 90
const COMPACT_THRESHOLD = 60

export function resolvePanelLayout(input: {
  cols: number
  override: PanelLayoutOverride
}): PanelLayoutMode {
  if (input.override !== undefined) {
    return input.override
  }
  if (input.cols >= FULL_THRESHOLD) return 'full'
  if (input.cols >= COMPACT_THRESHOLD) return 'compact'
  return 'minimal'
}
