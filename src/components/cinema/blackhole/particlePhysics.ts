/**
 * Particle motion helpers for the black-hole exit.
 *   easeInCubic  — accelerating curve (cubic)
 *   swapEvery    — frames between glyph swaps; 18 at t=0 → 1 at t=1
 *   rotateGlyph  — cycle ◆ → ▲ → ▼ → · → ◆
 *   particlePosition — lerp from start to center using easeInCubic(t)
 */

export type ParticleGlyph = '◆' | '▲' | '▼' | '·'

const GLYPH_CYCLE: readonly ParticleGlyph[] = ['◆', '▲', '▼', '·']

export function easeInCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * c
}

export function swapEvery(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return Math.max(1, Math.round(18 * (1 - c)))
}

export function rotateGlyph(g: ParticleGlyph, steps: number): ParticleGlyph {
  const idx = GLYPH_CYCLE.indexOf(g)
  if (idx < 0) return g
  return GLYPH_CYCLE[(idx + steps) % GLYPH_CYCLE.length]!
}

export type Point = { x: number; y: number }

export function particlePosition(input: {
  start: Point
  center: Point
  t: number
}): Point {
  const eased = easeInCubic(input.t)
  return {
    x: Math.round(input.start.x + (input.center.x - input.start.x) * eased),
    y: Math.round(input.start.y + (input.center.y - input.start.y) * eased),
  }
}
