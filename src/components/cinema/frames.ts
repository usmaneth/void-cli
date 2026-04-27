/**
 * Animation frame primitive for terminal animations.
 *
 * The pure helpers (`nextFrame`, `tickIntervalMs`) carry the logic and are
 * unit-tested. The `useFrame` hook is a thin React wrapper that drives a
 * frame counter via setInterval, advancing every tick. Used by:
 *   - Cinema (portal/black-hole) — ring expansion + particle motion
 *   - Status panel — the breathing effort dot
 *   - Ambient motion — spinner glyph cycling
 *
 * The hook is intentionally not unit-tested (Void's test suite doesn't render
 * React components). Integration use by downstream consumers exercises the
 * React shell — if the hook breaks, status panel or cinema would visibly fail.
 */
import { useEffect, useState } from 'react'

/**
 * Advance a frame index by one, wrapping at `count`. Degenerate input
 * (count <= 0) returns 0.
 */
export function nextFrame(current: number, count: number): number {
  if (count <= 0) return 0
  return (current + 1) % count
}

/**
 * Compute per-tick interval in ms. Returns null when the timer should be
 * disabled — count <= 0 or period <= 0.
 */
export function tickIntervalMs(count: number, period: number): number | null {
  if (count <= 0 || period <= 0) return null
  return period / count
}

/**
 * Returns the current frame index, advancing every (period / count) ms.
 * Frame index wraps from `count - 1` back to `0`. count<=0 or period<=0
 * disables the timer; the hook returns 0 in that case.
 */
export function useFrame(count: number, period: number): number {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const tickMs = tickIntervalMs(count, period)
    if (tickMs === null) return
    const id = setInterval(() => {
      setFrame((f) => nextFrame(f, count))
    }, tickMs)
    return () => clearInterval(id)
  }, [count, period])

  return frame
}
