import { describe, expect, it } from 'vitest'
import { seedParticles, PARTICLE_TOTAL, type Particle } from './particleSeed.js'

describe('seedParticles', () => {
  it('always returns exactly 104 particles regardless of terminal size', () => {
    expect(seedParticles({ cols: 80, rows: 24 }).length).toBe(PARTICLE_TOTAL)
    expect(seedParticles({ cols: 200, rows: 50 }).length).toBe(PARTICLE_TOTAL)
    expect(seedParticles({ cols: 40, rows: 15 }).length).toBe(PARTICLE_TOTAL)
  })

  it('includes 48 banner-perimeter particles', () => {
    const particles = seedParticles({ cols: 80, rows: 24 })
    const perimeter = particles.filter(p => p.source === 'perimeter')
    expect(perimeter.length).toBe(48)
  })

  it('includes 24 status-line particles along the bottom row', () => {
    const particles = seedParticles({ cols: 80, rows: 24 })
    const statusLine = particles.filter(p => p.source === 'status')
    expect(statusLine.length).toBe(24)
    const ys = new Set(statusLine.map(p => p.y))
    expect(ys.size).toBeLessThanOrEqual(2)
  })

  it('includes 32 random interior particles', () => {
    const particles = seedParticles({ cols: 80, rows: 24 })
    const interior = particles.filter(p => p.source === 'interior')
    expect(interior.length).toBe(32)
  })

  it('every particle has a glyph in [◆, ▲, ▼, ·]', () => {
    const particles = seedParticles({ cols: 80, rows: 24 })
    for (const p of particles) {
      expect(['◆', '▲', '▼', '·']).toContain(p.glyph)
    }
  })

  it('every particle has integer x/y within bounds', () => {
    const particles = seedParticles({ cols: 80, rows: 24 })
    for (const p of particles) {
      expect(Number.isInteger(p.x)).toBe(true)
      expect(Number.isInteger(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(80)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(24)
    }
  })

  it('seed is deterministic per (cols, rows) — repeat calls give same shape', () => {
    const a = seedParticles({ cols: 80, rows: 24 })
    const b = seedParticles({ cols: 80, rows: 24 })
    expect(a.length).toBe(b.length)
    const aInterior = a.filter(p => p.source === 'interior').map(p => `${p.x},${p.y}`).sort()
    const bInterior = b.filter(p => p.source === 'interior').map(p => `${p.x},${p.y}`).sort()
    expect(aInterior).toEqual(bInterior)
  })
})
