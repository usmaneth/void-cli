import { describe, expect, it } from 'vitest'
import {
  easeInCubic,
  swapEvery,
  rotateGlyph,
  particlePosition,
} from './particlePhysics.js'

describe('easeInCubic', () => {
  it('returns 0 at t=0 and 1 at t=1', () => {
    expect(easeInCubic(0)).toBe(0)
    expect(easeInCubic(1)).toBe(1)
  })

  it('is accelerating (concave-up): t=0.5 < 0.5', () => {
    expect(easeInCubic(0.5)).toBeLessThan(0.5)
  })

  it('clamps t < 0 to 0 and t > 1 to 1', () => {
    expect(easeInCubic(-0.1)).toBe(0)
    expect(easeInCubic(1.5)).toBe(1)
  })
})

describe('swapEvery', () => {
  it('returns 18 at t=0', () => {
    expect(swapEvery(0)).toBe(18)
  })

  it('returns 9 at t=0.5', () => {
    expect(swapEvery(0.5)).toBe(9)
  })

  it('returns ~2 at t=0.9', () => {
    expect(swapEvery(0.9)).toBe(2)
  })

  it('returns 1 at t=1.0', () => {
    expect(swapEvery(1.0)).toBe(1)
  })

  it('never returns less than 1', () => {
    expect(swapEvery(2.0)).toBe(1)
  })
})

describe('rotateGlyph', () => {
  it('cycles through ◆ → ▲ → ▼ → · → ◆', () => {
    expect(rotateGlyph('◆', 1)).toBe('▲')
    expect(rotateGlyph('▲', 1)).toBe('▼')
    expect(rotateGlyph('▼', 1)).toBe('·')
    expect(rotateGlyph('·', 1)).toBe('◆')
  })

  it('multi-step rotation', () => {
    expect(rotateGlyph('◆', 2)).toBe('▼')
    expect(rotateGlyph('◆', 4)).toBe('◆')
  })

  it('zero steps returns the same glyph', () => {
    expect(rotateGlyph('◆', 0)).toBe('◆')
  })
})

describe('particlePosition', () => {
  it('at t=0 returns the start position', () => {
    expect(particlePosition({ start: { x: 10, y: 5 }, center: { x: 40, y: 12 }, t: 0 })).toEqual({ x: 10, y: 5 })
  })

  it('at t=1 returns the center', () => {
    expect(particlePosition({ start: { x: 10, y: 5 }, center: { x: 40, y: 12 }, t: 1 })).toEqual({ x: 40, y: 12 })
  })

  it('at t=0.5 is between start and center, but closer to start (easeInCubic)', () => {
    const pos = particlePosition({ start: { x: 0, y: 0 }, center: { x: 100, y: 100 }, t: 0.5 })
    expect(pos.x).toBeLessThan(50)
    expect(pos.y).toBeLessThan(50)
  })
})
