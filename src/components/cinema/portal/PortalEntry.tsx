/**
 * Portal entry animation. 4 concentric rings expand outward from center,
 * staggered 400ms apart. Each ring's color shifts white→cyan→violet over
 * its lifecycle. Banner crystallizes in the last ~40% of frames via the
 * bannerBlur phase machine.
 *
 * Pure helper `computePortalFrame` — snapshot-testable. React component
 * drives via useFrame.
 */
import * as React from 'react'
import { Box, Text } from '../../../ink.js'
import { useFrame } from '../frames.js'
import { resolveRingColor } from './ringColor.js'
import { applyBlurPhase } from './bannerBlur.js'

const BASE_RADII = [3, 6, 10, 14] as const
const RING_STAGGER_FRAMES = 24
const RING_LIFETIME_FRAMES = 60
const BANNER_START_RATIO = 0.6
const REFERENCE_COLS = 80
const MAX_RING_RADIUS = 25
const TICKS_PER_SEC = 60

export type PortalFrameInput = {
  frame: number
  totalFrames: number
  cols: number
  rows: number
  bannerLines: readonly string[]
}

export type PortalRingState = {
  radius: number
  color: string | null
}

export type PortalFrameState = {
  centerCol: number
  centerRow: number
  rings: readonly PortalRingState[]
  bannerLines: readonly string[]
}

function scaleRadius(base: number, cols: number): number {
  const scaled = Math.round(base * (cols / REFERENCE_COLS))
  return Math.min(MAX_RING_RADIUS, Math.max(1, scaled))
}

export function computePortalFrame(input: PortalFrameInput): PortalFrameState {
  const centerCol = Math.floor(input.cols / 2)
  const centerRow = Math.floor(input.rows / 2)

  const rings: PortalRingState[] = []
  for (let i = 0; i < BASE_RADII.length; i++) {
    const spawnFrame = i * RING_STAGGER_FRAMES
    const localFrame = input.frame - spawnFrame
    if (localFrame < 0 || localFrame > RING_LIFETIME_FRAMES) continue
    const t = localFrame / RING_LIFETIME_FRAMES
    rings.push({
      radius: scaleRadius(BASE_RADII[i]!, input.cols),
      color: resolveRingColor(t),
    })
  }

  const bannerStartFrame = Math.floor(input.totalFrames * BANNER_START_RATIO)
  const bannerLines: string[] = []
  if (input.frame >= bannerStartFrame) {
    const localBannerFrame = input.frame - bannerStartFrame
    for (const line of input.bannerLines) {
      bannerLines.push(
        Array.from(line)
          .map(ch => applyBlurPhase(ch, localBannerFrame))
          .join(''),
      )
    }
  }

  return { centerCol, centerRow, rings, bannerLines }
}

export type PortalEntryProps = {
  durationMs: number
  cols: number
  rows: number
  bannerLines: readonly string[]
  onDone: () => void
}

export function PortalEntry({
  durationMs,
  cols,
  rows,
  bannerLines,
  onDone,
}: PortalEntryProps): React.ReactNode {
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * TICKS_PER_SEC))
  const frame = useFrame(totalFrames + 1, durationMs)

  React.useEffect(() => {
    if (frame >= totalFrames) onDone()
  }, [frame, totalFrames, onDone])

  const state = computePortalFrame({
    frame,
    totalFrames,
    cols,
    rows,
    bannerLines,
  })

  return (
    <Box flexDirection="column">
      {state.rings.map((ring, idx) =>
        ring.color === null ? null : (
          <Text key={idx} color={ring.color}>
            {`◆ r=${ring.radius}`}
          </Text>
        ),
      )}
      {state.bannerLines.map((line, idx) => (
        <Text key={`b${idx}`}>{line}</Text>
      ))}
    </Box>
  )
}
