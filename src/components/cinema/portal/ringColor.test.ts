import { describe, expect, it } from 'vitest'
import { resolveRingColor } from './ringColor.js'

describe('resolveRingColor', () => {
  it('returns bright white at t=0', () => {
    expect(resolveRingColor(0)).toBe('#ffffff')
  })

  it('returns cyan at t=0.5', () => {
    expect(resolveRingColor(0.5)).toBe('#7dcfff')
  })

  it('returns violet at t=1.0', () => {
    expect(resolveRingColor(1.0)).toBe('#bb9af7')
  })

  it('downshifts to dim variant after t > 0.85', () => {
    expect(resolveRingColor(0.86)).toBe('#3d4266')
    expect(resolveRingColor(0.94)).toBe('#3d4266')
  })

  it('returns null at t > 0.95', () => {
    expect(resolveRingColor(0.96)).toBeNull()
    expect(resolveRingColor(1.0)).toBe('#bb9af7')
  })

  it('clamps t < 0 to start, t > 1 still hits null branch', () => {
    expect(resolveRingColor(-0.5)).toBe('#ffffff')
    expect(resolveRingColor(1.5)).toBeNull()
  })

  it('interpolation between waypoints — t=0.25 is between white and cyan', () => {
    const c = resolveRingColor(0.25)
    expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    expect(c).not.toBe('#ffffff')
    expect(c).not.toBe('#7dcfff')
  })
})
