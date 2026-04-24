import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box, useAnimationFrame } from '../../ink.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { Clawd, COMPACT_PORTAL_HEIGHT, PORTAL_HEIGHT } from './Clawd.js'

// Total duration of the one-shot "materialization" on first mount.
// Rings appear outside-in; the brand row resolves last.
const MATERIALIZE_DURATION_MS = 900
// Shimmer pulse runs at ~16fps — smooth enough for the slow wave without
// being heavy. The wave itself completes one cycle every 1800ms.
const SHIMMER_FRAME_MS = 60

type Props = {
  /**
   * Condensed 3-row variant for the `CondensedLogo` slot.
   */
  compact?: boolean
}

/**
 * Portal with:
 *   1. One-shot materialize animation on first mount (outer → inner rings).
 *   2. Idle shimmer pulse that flows radially from the brand row outward.
 * Container height is fixed at the appropriate portal height so surrounding
 * layout never shifts during the animation. Both animations fall back to
 * a static fully-materialized portal when prefersReducedMotion is set.
 */
export function AnimatedClawd({ compact = false }: Props = {}): React.ReactNode {
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  )
  const mountTimeRef = useRef<number | null>(null)
  const [materializeDone, setMaterializeDone] = useState(reducedMotion)

  // Drive shimmer + materialization on the shared ink clock.
  // Pass null to the frame hook after we're done animating so we stop
  // consuming the clock.
  const isAnimating = !reducedMotion && !materializeDone
  const [, time] = useAnimationFrame(isAnimating ? SHIMMER_FRAME_MS : null)

  if (mountTimeRef.current === null && time > 0) {
    mountTimeRef.current = time
  }

  const elapsed = mountTimeRef.current === null ? 0 : time - mountTimeRef.current

  // The compact variant has only 2 depth steps (brand + one outer ring)
  // so its materialize sweep is shorter.
  const maxSteps = compact ? 2 : PORTAL_HEIGHT
  const materializeFrame = reducedMotion
    ? undefined
    : Math.min(
        maxSteps + 1,
        Math.ceil((elapsed / MATERIALIZE_DURATION_MS) * (maxSteps + 1)),
      )

  useEffect(() => {
    if (reducedMotion) return
    const timer = setTimeout(
      () => setMaterializeDone(true),
      MATERIALIZE_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [reducedMotion])

  const height = compact ? COMPACT_PORTAL_HEIGHT : PORTAL_HEIGHT

  return (
    <Box height={height} flexDirection="column">
      <Clawd
        compact={compact}
        time={elapsed}
        materializeFrame={materializeDone ? undefined : materializeFrame}
        reducedMotion={reducedMotion}
      />
    </Box>
  )
}
