/**
 * Synthesizes 104 particles at exit-animation start. Three sources:
 *   - 48 banner-perimeter (12 per side of a centered box)
 *   - 24 status-line (along bottom row, evenly spaced)
 *   - 32 random interior (deterministic seed for reproducibility)
 *
 * Always 104 — does not read terminal state. Position math clamps to the
 * provided (cols, rows) so the output is safe to render at any size.
 */

export type ParticleGlyph = '◆' | '▲' | '▼' | '·'
export type ParticleSource = 'perimeter' | 'status' | 'interior'

export type Particle = {
  x: number
  y: number
  glyph: ParticleGlyph
  source: ParticleSource
}

export const PARTICLE_TOTAL = 104
const PERIMETER_COUNT = 48
const STATUS_COUNT = 24
const INTERIOR_COUNT = 32

const GLYPHS: readonly ParticleGlyph[] = ['◆', '▲', '▼', '·']

// Fixed integer seed for reproducible interior/glyph picks. "Cold case" in
// leet-hex — arbitrary but deterministic, so the same (cols, rows) always
// produces the same particle layout across runs and test invocations.
const SEED = 0xc01dca5e

function pseudoRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function pickGlyph(rand: () => number): ParticleGlyph {
  return GLYPHS[Math.floor(rand() * GLYPHS.length)]!
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function seedParticles(input: {
  cols: number
  rows: number
}): readonly Particle[] {
  const { cols, rows } = input
  const rand = pseudoRandom(SEED)
  const particles: Particle[] = []

  const bw = Math.min(60, Math.max(2, cols - 4))
  const bh = Math.min(6, Math.max(2, rows - 4))
  const bx = Math.floor((cols - bw) / 2)
  const by = Math.max(0, Math.floor((rows - bh) / 2) - Math.floor(rows / 6))
  const perSide = PERIMETER_COUNT / 4

  for (let i = 0; i < perSide; i++) {
    particles.push({
      x: clamp(bx + Math.round((bw / Math.max(1, perSide - 1)) * i), 0, cols - 1),
      y: clamp(by, 0, rows - 1),
      glyph: pickGlyph(rand),
      source: 'perimeter',
    })
    particles.push({
      x: clamp(bx + Math.round((bw / Math.max(1, perSide - 1)) * i), 0, cols - 1),
      y: clamp(by + bh, 0, rows - 1),
      glyph: pickGlyph(rand),
      source: 'perimeter',
    })
    particles.push({
      x: clamp(bx, 0, cols - 1),
      y: clamp(by + Math.round((bh / Math.max(1, perSide - 1)) * i), 0, rows - 1),
      glyph: pickGlyph(rand),
      source: 'perimeter',
    })
    particles.push({
      x: clamp(bx + bw, 0, cols - 1),
      y: clamp(by + Math.round((bh / Math.max(1, perSide - 1)) * i), 0, rows - 1),
      glyph: pickGlyph(rand),
      source: 'perimeter',
    })
  }

  for (let i = 0; i < STATUS_COUNT; i++) {
    particles.push({
      x: clamp(Math.round((cols / Math.max(1, STATUS_COUNT - 1)) * i), 0, cols - 1),
      y: rows - 1,
      glyph: pickGlyph(rand),
      source: 'status',
    })
  }

  for (let i = 0; i < INTERIOR_COUNT; i++) {
    particles.push({
      x: 1 + Math.floor(rand() * Math.max(1, cols - 2)),
      y: 1 + Math.floor(rand() * Math.max(1, rows - 2)),
      glyph: pickGlyph(rand),
      source: 'interior',
    })
  }

  return particles
}
