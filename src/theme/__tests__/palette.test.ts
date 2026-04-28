import { describe, expect, it } from 'vitest'
import { getTheme } from '../../utils/theme.js'

describe('palette tokens', () => {
  it('exposes all 11 semantic tokens with correct hex values', () => {
    const p = getTheme('dark').palette
    expect(p).toBeDefined()
    expect(p.brand.diamond).toBe('#7dcfff')
    expect(p.brand.accent).toBe('#bb9af7')
    expect(p.role.you).toBe('#bb9af7')
    expect(p.role.voidProse).toBe('#7dcfff')
    expect(p.role.voidWrite).toBe('#e0af68')
    expect(p.state.success).toBe('#9ece6a')
    expect(p.state.failure).toBe('#f7768e')
    expect(p.state.warning).toBe('#e0af68')
    expect(p.state.confident).toBe('#ffffff')
    expect(p.text.default).toBe('#9aa5ce')
    expect(p.text.dim).toBe('#565f89')
    expect(p.text.dimmer).toBe('#3d4266')
  })
})
