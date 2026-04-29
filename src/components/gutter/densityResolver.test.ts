import { describe, expect, it } from 'vitest'
import { resolveDensity, cycleDensity, type Density } from './densityResolver.js'

describe('resolveDensity', () => {
  it('returns "full" at >= 80 cols with no override', () => {
    expect(resolveDensity({ cols: 80, override: undefined })).toBe('full')
    expect(resolveDensity({ cols: 200, override: undefined })).toBe('full')
  })

  it('returns "compressed" at 60..79 cols', () => {
    expect(resolveDensity({ cols: 60, override: undefined })).toBe('compressed')
    expect(resolveDensity({ cols: 79, override: undefined })).toBe('compressed')
  })

  it('returns "minimal" below 60 cols', () => {
    expect(resolveDensity({ cols: 59, override: undefined })).toBe('minimal')
    expect(resolveDensity({ cols: 30, override: undefined })).toBe('minimal')
  })

  it('user override wins over auto-downgrade', () => {
    expect(resolveDensity({ cols: 30, override: 'full' })).toBe('full')
    expect(resolveDensity({ cols: 200, override: 'minimal' })).toBe('minimal')
  })

  it('handles 0 cols (degenerate) → minimal', () => {
    expect(resolveDensity({ cols: 0, override: undefined })).toBe('minimal')
  })
})

describe('cycleDensity', () => {
  it('cycles Full → Compressed → Minimal → Full', () => {
    expect(cycleDensity('full')).toBe('compressed')
    expect(cycleDensity('compressed')).toBe('minimal')
    expect(cycleDensity('minimal')).toBe('full')
  })
})
