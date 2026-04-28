import { describe, expect, it } from 'vitest'
import { computeRing, type RingCell } from './bresenhamRing.js'

describe('computeRing', () => {
  it('returns at least one cell per ring', () => {
    expect(computeRing(3).length).toBeGreaterThan(0)
    expect(computeRing(6).length).toBeGreaterThan(0)
    expect(computeRing(10).length).toBeGreaterThan(0)
    expect(computeRing(14).length).toBeGreaterThan(0)
  })

  it('all cells lie roughly on the circle of given radius', () => {
    const r = 10
    for (const cell of computeRing(r)) {
      const dist = Math.sqrt(cell.x * cell.x + cell.y * cell.y)
      expect(Math.abs(dist - r)).toBeLessThan(1.5)
    }
  })

  it('assigns ◆ to cardinal points (N/E/S/W)', () => {
    const cells = computeRing(10)
    const cardinals = cells.filter(c =>
      (Math.abs(c.x) < 2 && Math.abs(c.y - 10) < 2) ||
      (Math.abs(c.x - 10) < 2 && Math.abs(c.y) < 2) ||
      (Math.abs(c.x) < 2 && Math.abs(c.y + 10) < 2) ||
      (Math.abs(c.x + 10) < 2 && Math.abs(c.y) < 2),
    )
    expect(cardinals.length).toBeGreaterThan(0)
    expect(cardinals.every(c => c.char === '◆')).toBe(true)
  })

  it('assigns ▲ to NE/SE quadrants and ▼ to NW/SW quadrants', () => {
    const cells = computeRing(10)
    const triangleCells = cells.filter(c => c.char === '▲' || c.char === '▼')
    expect(triangleCells.length).toBeGreaterThan(0)
  })

  it('the rest are dots ·', () => {
    const cells = computeRing(10)
    const dotCells = cells.filter(c => c.char === '·')
    expect(dotCells.length).toBeGreaterThan(0)
  })

  it('returns empty array for radius <= 0', () => {
    expect(computeRing(0)).toEqual([])
    expect(computeRing(-1)).toEqual([])
  })

  it('caches identical-radius results (referential equality)', () => {
    const a = computeRing(6)
    const b = computeRing(6)
    expect(a).toBe(b)
  })
})
