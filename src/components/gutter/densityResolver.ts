/**
 * Resolves gutter density from terminal width and user override.
 *   full       — box-frames + heartbeat rail (≥ 80 cols)
 *   compressed — single-line headers + heartbeat rail (60..79)
 *   minimal    — solid │ rail (< 60)
 *
 * cycleDensity walks Full → Compressed → Minimal → Full (Ctrl+G).
 */

export type Density = 'full' | 'compressed' | 'minimal'
export type DensityOverride = Density | undefined

const FULL_THRESHOLD = 80
const COMPRESSED_THRESHOLD = 60

export function resolveDensity(input: {
  cols: number
  override: DensityOverride
}): Density {
  if (input.override !== undefined) return input.override
  if (input.cols >= FULL_THRESHOLD) return 'full'
  if (input.cols >= COMPRESSED_THRESHOLD) return 'compressed'
  return 'minimal'
}

export function cycleDensity(current: Density): Density {
  if (current === 'full') return 'compressed'
  if (current === 'compressed') return 'minimal'
  return 'full'
}
