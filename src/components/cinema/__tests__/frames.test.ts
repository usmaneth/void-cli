import { describe, expect, it } from 'vitest'
import { nextFrame, tickIntervalMs } from '../frames.js'

describe('nextFrame', () => {
  it('advances by one and wraps at count', () => {
    expect(nextFrame(0, 4)).toBe(1)
    expect(nextFrame(1, 4)).toBe(2)
    expect(nextFrame(2, 4)).toBe(3)
    expect(nextFrame(3, 4)).toBe(0) // wrap
  })

  it('handles count of 1 (always returns 0)', () => {
    expect(nextFrame(0, 1)).toBe(0)
  })

  it('returns 0 for degenerate count', () => {
    expect(nextFrame(0, 0)).toBe(0)
    expect(nextFrame(5, 0)).toBe(0)
    expect(nextFrame(2, -1)).toBe(0)
  })

  it('handles current >= count gracefully (modulo wraps)', () => {
    expect(nextFrame(7, 4)).toBe(0) // 8 % 4
    expect(nextFrame(10, 3)).toBe(2) // 11 % 3
  })
})

describe('tickIntervalMs', () => {
  it('returns period/count for valid inputs', () => {
    expect(tickIntervalMs(4, 100)).toBe(25)
    expect(tickIntervalMs(8, 200)).toBe(25)
    expect(tickIntervalMs(1, 1000)).toBe(1000)
  })

  it('returns null when count <= 0', () => {
    expect(tickIntervalMs(0, 100)).toBeNull()
    expect(tickIntervalMs(-1, 100)).toBeNull()
  })

  it('returns null when period <= 0', () => {
    expect(tickIntervalMs(4, 0)).toBeNull()
    expect(tickIntervalMs(4, -1)).toBeNull()
  })
})
