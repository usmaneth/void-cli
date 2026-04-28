/**
 * Single-character pulsing dot representing effort/health state.
 *
 * - Color encodes urgency: success (calm) → warning (compact-soon) → failure (compact-now)
 * - Pulse period encodes activity: 2s when idle, 400ms during stream OR critical
 *
 * Drives via Phase 0's useFrame primitive — frame index modulates "opacity"
 * via bright/dim toggle each half cycle. Ink can't actually animate alpha,
 * so we approximate by switching between the active color and palette.text.dim.
 */
import * as React from 'react'
import { Text } from '../../ink.js'
import { useFrame } from '../cinema/frames.js'
import { getPalette } from '../../theme/index.js'

export type EffortDotState = {
  colorToken: 'state.success' | 'state.warning' | 'state.failure'
  periodMs: number
}

const FAST_PERIOD = 400
const SLOW_PERIOD = 2000
const CRITICAL_THRESHOLD = 0.95
const WARNING_THRESHOLD = 0.85

export function resolveEffortDotState(input: {
  streamActive: boolean
  contextRatio: number
}): EffortDotState {
  if (input.contextRatio >= CRITICAL_THRESHOLD) {
    return { colorToken: 'state.failure', periodMs: FAST_PERIOD }
  }
  if (input.contextRatio >= WARNING_THRESHOLD) {
    return { colorToken: 'state.warning', periodMs: SLOW_PERIOD }
  }
  return {
    colorToken: 'state.success',
    periodMs: input.streamActive ? FAST_PERIOD : SLOW_PERIOD,
  }
}

const DOT = '●'
const PULSE_FRAMES = 6

export type EffortDotProps = {
  streamActive: boolean
  contextRatio: number
}

export function EffortDot({
  streamActive,
  contextRatio,
}: EffortDotProps): React.ReactNode {
  const palette = getPalette()
  const { colorToken, periodMs } = resolveEffortDotState({ streamActive, contextRatio })
  const frame = useFrame(PULSE_FRAMES, periodMs)

  const half = PULSE_FRAMES / 2
  const isBright = frame < half

  const activeColor =
    colorToken === 'state.success'
      ? palette.state.success
      : colorToken === 'state.warning'
        ? palette.state.warning
        : palette.state.failure

  const color = isBright ? activeColor : palette.text.dim

  return <Text color={color}>{DOT}</Text>
}
