import { describe, expect, it } from 'vitest'
import { classifyDensity, applyBlurPhase } from './bannerBlur.js'

describe('classifyDensity', () => {
  it('classifies dense glyphs', () => {
    expect(classifyDensity('█')).toBe('dense')
    expect(classifyDensity('▓')).toBe('dense')
    expect(classifyDensity('◆')).toBe('dense')
    expect(classifyDensity('▲')).toBe('dense')
    expect(classifyDensity('▼')).toBe('dense')
  })

  it('classifies medium glyphs', () => {
    expect(classifyDensity('│')).toBe('medium')
    expect(classifyDensity('─')).toBe('medium')
    expect(classifyDensity('V')).toBe('medium')
    expect(classifyDensity('O')).toBe('medium')
    expect(classifyDensity('I')).toBe('medium')
    expect(classifyDensity('D')).toBe('medium')
  })

  it('classifies light glyphs', () => {
    expect(classifyDensity('·')).toBe('light')
    expect(classifyDensity(' ')).toBe('light')
    expect(classifyDensity('.')).toBe('light')
    expect(classifyDensity(',')).toBe('light')
  })
})

describe('applyBlurPhase', () => {
  it('frames 0-10: all blurred — dense survives, medium → ·, light → space', () => {
    expect(applyBlurPhase('█', 5)).toBe('█')
    expect(applyBlurPhase('V', 5)).toBe('·')
    expect(applyBlurPhase('·', 5)).toBe(' ')
    expect(applyBlurPhase(' ', 5)).toBe(' ')
  })

  it('frames 11-18: medium becomes sharp', () => {
    expect(applyBlurPhase('V', 12)).toBe('V')
    expect(applyBlurPhase('·', 12)).toBe(' ')
    expect(applyBlurPhase('▓', 12)).toBe('▓')
  })

  it('frames 19-24: light becomes sharp', () => {
    expect(applyBlurPhase('V', 20)).toBe('V')
    expect(applyBlurPhase('·', 20)).toBe('·')
  })

  it('frames 25+: full resolution', () => {
    expect(applyBlurPhase('V', 30)).toBe('V')
    expect(applyBlurPhase('·', 30)).toBe('·')
    expect(applyBlurPhase('█', 30)).toBe('█')
  })

  it('boundary frames: 10 still all-blurred, 11 already medium-sharp', () => {
    expect(applyBlurPhase('V', 10)).toBe('·')
    expect(applyBlurPhase('V', 11)).toBe('V')
  })
})
