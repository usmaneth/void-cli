import { describe, expect, it } from 'vitest'
import { resolveContextBarColor } from './contextBarColor.js'
import { getPalette } from '../../theme/index.js'

describe('resolveContextBarColor', () => {
  const p = getPalette()

  it('cyan below 40%', () => {
    expect(resolveContextBarColor(0)).toBe(p.role.voidProse)
    expect(resolveContextBarColor(0.39)).toBe(p.role.voidProse)
  })

  it('amber from 40% to 70%', () => {
    expect(resolveContextBarColor(0.4)).toBe(p.state.warning)
    expect(resolveContextBarColor(0.69)).toBe(p.state.warning)
  })

  it('red from 70% to 90%', () => {
    expect(resolveContextBarColor(0.7)).toBe(p.state.failure)
    expect(resolveContextBarColor(0.89)).toBe(p.state.failure)
  })

  it('red above 90%', () => {
    expect(resolveContextBarColor(0.9)).toBe(p.state.failure)
    expect(resolveContextBarColor(0.99)).toBe(p.state.failure)
    expect(resolveContextBarColor(1.0)).toBe(p.state.failure)
  })

  it('clamps to [0, 1]', () => {
    expect(resolveContextBarColor(-0.5)).toBe(p.role.voidProse)
    expect(resolveContextBarColor(2.0)).toBe(p.state.failure)
  })
})
