/**
 * Bottom-right corner ◆ that pulses at 2s when idle, 500ms during stream.
 * Mounted once at the root layout (wired in B7); gives ambient health
 * signal — if Void crashes or hangs, the diamond stops breathing.
 *
 * Same bright/dim toggle pattern as EffortDot, since Ink can't do alpha.
 */
import * as React from 'react'
import { Text } from '../../ink.js'
import { useFrame } from '../cinema/frames.js'
import { getPalette } from '../../theme/index.js'

const IDLE_PERIOD = 2000
const STREAM_PERIOD = 500
const PULSE_FRAMES = 8

export function resolveIdleDiamondPeriod(input: { streamActive: boolean }): number {
  return input.streamActive ? STREAM_PERIOD : IDLE_PERIOD
}

export type IdleDiamondProps = {
  streamActive: boolean
}

export function IdleDiamond({ streamActive }: IdleDiamondProps): React.ReactNode {
  const palette = getPalette()
  const period = resolveIdleDiamondPeriod({ streamActive })
  const frame = useFrame(PULSE_FRAMES, period)

  const half = PULSE_FRAMES / 2
  const isBright = frame < half
  const color = isBright ? palette.brand.accent : palette.text.dimmer

  return <Text color={color}>◆</Text>
}
