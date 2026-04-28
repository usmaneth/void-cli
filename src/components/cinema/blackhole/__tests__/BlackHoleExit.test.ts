import { describe, expect, it } from 'vitest'
import { computeBlackHoleFrame, type BlackHoleFrameInput } from '../BlackHoleExit.js'
import { seedParticles, PARTICLE_TOTAL } from '../particleSeed.js'

describe('computeBlackHoleFrame', () => {
  const cols = 80
  const rows = 24
  const startParticles = seedParticles({ cols, rows })

  const baseInput: BlackHoleFrameInput = {
    frame: 0,
    totalFrames: 168,
    cols,
    rows,
    startParticles,
  }

  it('at frame 0, all particles at start positions', () => {
    const out = computeBlackHoleFrame(baseInput)
    expect(out.particles.length).toBe(PARTICLE_TOTAL)
    expect(out.flash).toBe(false)
  })

  it('at half time, particles still rendering', () => {
    const out = computeBlackHoleFrame({ ...baseInput, frame: 84 })
    expect(out.particles.length).toBeGreaterThan(0)
  })

  it('singularity flash on at t=0.88', () => {
    const flashFrame = Math.round(168 * 0.88)
    const out = computeBlackHoleFrame({ ...baseInput, frame: flashFrame })
    expect(out.flash).toBe(true)
  })

  it('particles within 1 cell of center are despawned', () => {
    const out = computeBlackHoleFrame({ ...baseInput, frame: 165 })
    for (const p of out.particles) {
      const dx = p.x - Math.floor(cols / 2)
      const dy = p.y - Math.floor(rows / 2)
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(1)
    }
  })

  it('center is at floor(cols/2), floor(rows/2)', () => {
    const out = computeBlackHoleFrame(baseInput)
    expect(out.centerCol).toBe(40)
    expect(out.centerRow).toBe(12)
  })

  it('at t=1.0, the buffer is cleared (no particles, no flash)', () => {
    const out = computeBlackHoleFrame({ ...baseInput, frame: 168 })
    expect(out.particles.length).toBe(0)
    expect(out.flash).toBe(false)
  })
})
