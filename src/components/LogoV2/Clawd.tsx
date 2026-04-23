import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose =
  | 'default' // static portal
  | 'arms-up' // reserved for API compat — currently ignored by portal art
  | 'look-left' // reserved for API compat
  | 'look-right' // reserved for API compat

type Props = {
  pose?: ClawdPose
  /**
   * Optional animation clock (ms since mount). When provided, enables the
   * idle shimmer pulse that flows outward from the brand row. Callers pass
   * 0 (or omit) for a fully static portal.
   */
  time?: number
  /**
   * Optional materialization frame (0 = invisible, 1..PORTAL_HEIGHT = rings
   * appear outside-in). Callers can omit for a fully-materialized portal.
   */
  materializeFrame?: number
  /** Disable motion entirely — honors prefersReducedMotion */
  reducedMotion?: boolean
  /**
   * Condensed 3-row variant for the `CondensedLogo` slot where we only
   * have room for a handful of rows next to the info column.
   */
  compact?: boolean
}

// Each row's "depth" from the brand row (0 = brand row, higher = outer ring).
// Drives color intensity: low depth → brightest (claudeShimmer), high → dim.
// 9-row stargate portal; each row is exactly 21 visual columns wide and
// mirror-symmetric around column 10. Spaces matter — don't auto-format.
// prettier-ignore
const PORTAL_ROWS: readonly { text: string; depth: number }[] = [
  { text: '       ·  ✦  ·       ', depth: 4 },
  { text: '    ·   ▲   ▲   ·    ', depth: 3 },
  { text: '    ·  ▲  ▼  ▲  ·    ', depth: 2 },
  { text: '   ·  ▲  ▼ ▼  ▲  ·   ', depth: 1 },
  { text: '  ◀ V · O · I · D ▶  ', depth: 0 },
  { text: '   ·  ▼  ▲ ▲  ▼  ·   ', depth: 1 },
  { text: '    ·  ▼  ▲  ▼  ·    ', depth: 2 },
  { text: '    ·   ▼   ▼   ·    ', depth: 3 },
  { text: '       ·  ✦  ·       ', depth: 4 },
]

export const PORTAL_HEIGHT = PORTAL_ROWS.length
export const PORTAL_WIDTH = 21

// Compact 3-row variant used in `CondensedLogo` alongside a 3-line info
// column. Same aesthetic — a centered brand row flanked by single-ring
// triangle accents — at 11 visual columns wide.
// prettier-ignore
const COMPACT_ROWS: readonly { text: string; depth: number }[] = [
  { text: ' · ▲   ▲ · ', depth: 1 },
  { text: '◀ V·O·I·D ▶', depth: 0 },
  { text: ' · ▼   ▼ · ', depth: 1 },
]
export const COMPACT_PORTAL_HEIGHT = COMPACT_ROWS.length
export const COMPACT_PORTAL_WIDTH = 11

// Shimmer pulse: a single "wave" that travels from brand row outward and
// back on a ~1800ms cycle. The nearest ring to the wave front gets lifted
// to shimmer brightness; all other rings use their base color layer.
const SHIMMER_CYCLE_MS = 1800
const MAX_DEPTH = 4

function getShimmerDepth(time: number): number {
  // Triangular wave 0 → 4 → 0 over SHIMMER_CYCLE_MS.
  const phase = (time % SHIMMER_CYCLE_MS) / SHIMMER_CYCLE_MS // 0..1
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2 // 0..1..0
  return t * MAX_DEPTH
}

/**
 * Void portal mascot — a 9-row concentric stargate with the brand spelled
 * through the center row. Replaces the legacy pig. The portal accepts a
 * `time` clock to drive an idle shimmer pulse, and `materializeFrame` to
 * gate how many rings are visible for the one-shot boot animation.
 */
export function Clawd({
  time = 0,
  materializeFrame,
  reducedMotion = false,
  compact = false,
}: Props = {}): React.ReactNode {
  const shimmerDepth = reducedMotion ? -1 : getShimmerDepth(time)
  // In compact mode we only have one ring + brand, so the wave bounces
  // between depths 0 and 1 on half the cycle for a tighter pulse.
  const maxDepth = compact ? 1 : MAX_DEPTH
  // materializeFrame gates how many rings are visible. Outer rings (high
  // depth) appear first; the brand row (depth 0) resolves last.
  //   frame 0        → nothing visible
  //   frame 1        → outermost ring (depth 4)
  //   frame 2        → depths 4..3
  //   ...
  //   frame >= maxDepth+1 or undefined → fully materialized
  const materialized =
    materializeFrame === undefined || materializeFrame > maxDepth
  // A row is hidden while its depth is strictly less than this threshold.
  const hideBelowDepth = materialized
    ? -1
    : maxDepth + 1 - (materializeFrame ?? 0)

  const rows = compact ? COMPACT_ROWS : PORTAL_ROWS
  const width = compact ? COMPACT_PORTAL_WIDTH : PORTAL_WIDTH

  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, i) => {
        if (row.depth < hideBelowDepth) {
          // Render a blank row so vertical layout doesn't shift.
          return (
            <Text key={i} color="claude">
              {' '.repeat(width)}
            </Text>
          )
        }

        const isBrand = row.depth === 0
        // Shimmer boost: if the wave is passing near this ring, lift it.
        const shimmerDistance = Math.abs(row.depth - shimmerDepth)
        const isShimmered = !reducedMotion && shimmerDistance < 0.75

        // Outer sparkle rings get a subtler treatment (only in full mode).
        if (!compact && row.depth === 4) {
          return (
            <Text key={i} color="claude" dimColor={!isShimmered}>
              {row.text}
            </Text>
          )
        }

        if (isBrand) {
          // Brand row always bold + bright; shimmer cycles between claude and claudeShimmer.
          return (
            <Text
              key={i}
              bold
              color={isShimmered ? 'claudeShimmer' : 'claude'}
            >
              {row.text}
            </Text>
          )
        }

        // Inner/mid rings: claudeShimmer when boosted, claude otherwise.
        return (
          <Text key={i} color={isShimmered ? 'claudeShimmer' : 'claude'}>
            {row.text}
          </Text>
        )
      })}
    </Box>
  )
}
