import { describe, expect, it } from 'vitest'
import { computePortalFrame, type PortalFrameInput } from '../PortalEntry.js'

describe('computePortalFrame', () => {
  const baseInput: PortalFrameInput = {
    frame: 0,
    totalFrames: 132,
    cols: 80,
    rows: 24,
    bannerLines: ['VOID', '────'],
  }

  it('returns at least one ring at frame 1 (first ring just spawned)', () => {
    const out = computePortalFrame({ ...baseInput, frame: 1 })
    expect(out.rings.length).toBeGreaterThanOrEqual(1)
  })

  it('returns up to 4 rings during full expansion', () => {
    const out = computePortalFrame({ ...baseInput, frame: 80 })
    expect(out.rings.length).toBeGreaterThanOrEqual(1)
    expect(out.rings.length).toBeLessThanOrEqual(4)
  })

  it('rings each have a color OR null (null = skip render)', () => {
    const out = computePortalFrame({ ...baseInput, frame: 50 })
    for (const ring of out.rings) {
      expect(ring.color === null || /^#[0-9a-f]{6}$/i.test(ring.color)).toBe(true)
    }
  })

  it('banner is empty before frame 79 (no banner phase)', () => {
    const out = computePortalFrame({ ...baseInput, frame: 30 })
    expect(out.bannerLines).toEqual([])
  })

  it('banner appears in last ~40% of frames', () => {
    const out = computePortalFrame({ ...baseInput, frame: 100 })
    expect(out.bannerLines.length).toBeGreaterThan(0)
  })

  it('center is at floor(cols/2), floor(rows/2)', () => {
    const out = computePortalFrame({ ...baseInput, frame: 1 })
    expect(out.centerCol).toBe(40)
    expect(out.centerRow).toBe(12)
  })

  it('ring radii scale with cols (reference 80) but clamp at 25', () => {
    const wide = computePortalFrame({ ...baseInput, cols: 200, frame: 50 })
    for (const ring of wide.rings) {
      expect(ring.radius).toBeLessThanOrEqual(25)
    }
  })
})
