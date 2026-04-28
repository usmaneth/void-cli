/**
 * Black-hole exit animation. 104 particles spiral inward via easeInCubic,
 * rotating glyphs at swapEvery rate. Singularity flash at t=0.88. Buffer
 * cleared at t=1.0.
 *
 * Pure helper `computeBlackHoleFrame` — snapshot-testable. React component
 * drives via useFrame.
 */
import * as React from 'react'
import { Box, Text } from '../../../ink.js'
import { useFrame } from '../frames.js'
import { getPalette } from '../../../theme/index.js'
import {
  swapEvery,
  rotateGlyph,
  particlePosition,
  type ParticleGlyph,
} from './particlePhysics.js'
import { seedParticles, type Particle } from './particleSeed.js'

const FLASH_AT = 0.88
const FLASH_WINDOW = 0.04
const CLEAR_AT = 1.0
const TICKS_PER_SEC = 60

export type BlackHoleFrameInput = {
  frame: number
  totalFrames: number
  cols: number
  rows: number
  startParticles: readonly Particle[]
}

export type RenderedParticle = {
  x: number
  y: number
  glyph: ParticleGlyph
  color: string
}

export type BlackHoleFrameState = {
  centerCol: number
  centerRow: number
  particles: readonly RenderedParticle[]
  flash: boolean
}

function colorFor(t: number, palette: ReturnType<typeof getPalette>): string {
  if (t < 0.33) return palette.text.dim
  if (t < 0.66) return palette.brand.accent
  if (t < 0.95) return palette.role.voidProse
  return palette.state.confident
}

export function computeBlackHoleFrame(input: BlackHoleFrameInput): BlackHoleFrameState {
  const palette = getPalette()
  const centerCol = Math.floor(input.cols / 2)
  const centerRow = Math.floor(input.rows / 2)
  const t = input.frame / input.totalFrames

  if (t >= CLEAR_AT) {
    return { centerCol, centerRow, particles: [], flash: false }
  }

  const flash = t >= FLASH_AT && t < FLASH_AT + FLASH_WINDOW

  const particles: RenderedParticle[] = []
  const swap = swapEvery(t)
  const rotationSteps = swap > 0 ? Math.floor(input.frame / swap) : 0

  for (const p of input.startParticles) {
    const pos = particlePosition({
      start: { x: p.x, y: p.y },
      center: { x: centerCol, y: centerRow },
      t,
    })
    const dx = pos.x - centerCol
    const dy = pos.y - centerRow
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= 1) continue

    particles.push({
      x: pos.x,
      y: pos.y,
      glyph: rotateGlyph(p.glyph as ParticleGlyph, rotationSteps),
      color: colorFor(t, palette),
    })
  }

  return { centerCol, centerRow, particles, flash }
}

export type BlackHoleExitProps = {
  durationMs: number
  cols: number
  rows: number
  onDone: () => void
}

export function BlackHoleExit({
  durationMs,
  cols,
  rows,
  onDone,
}: BlackHoleExitProps): React.ReactNode {
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * TICKS_PER_SEC))
  const frame = useFrame(totalFrames + 1, durationMs)
  const palette = getPalette()
  const startParticles = React.useMemo(
    () => seedParticles({ cols, rows }),
    [cols, rows],
  )

  React.useEffect(() => {
    if (frame >= totalFrames) onDone()
  }, [frame, totalFrames, onDone])

  const state = computeBlackHoleFrame({
    frame,
    totalFrames,
    cols,
    rows,
    startParticles,
  })

  return (
    <Box flexDirection="column">
      {state.particles.map((p, idx) => (
        <Text key={idx} color={p.color}>
          {p.glyph}
        </Text>
      ))}
      {state.flash && <Text color={palette.state.confident}>◆</Text>}
    </Box>
  )
}
