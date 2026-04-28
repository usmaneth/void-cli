import { describe, expect, it } from 'vitest'
import { resolveSpanColor } from '../BreathingParagraph.js'
import { getPalette } from '../../../theme/index.js'

describe('resolveSpanColor', () => {
  const palette = getPalette()

  it('default → palette.text.default', () => {
    expect(resolveSpanColor('default')).toBe(palette.text.default)
  })

  it('confident → palette.state.confident', () => {
    expect(resolveSpanColor('confident')).toBe(palette.state.confident)
  })

  it('codeRef → palette.role.voidProse', () => {
    expect(resolveSpanColor('codeRef')).toBe(palette.role.voidProse)
  })

  it('hedge → palette.state.warning', () => {
    expect(resolveSpanColor('hedge')).toBe(palette.state.warning)
  })

  it('blocked → palette.state.failure', () => {
    expect(resolveSpanColor('blocked')).toBe(palette.state.failure)
  })
})
