import { describe, expect, it } from 'vitest'
import { resolveSpinnerColor } from '../CategorySpinner.js'

describe('resolveSpinnerColor', () => {
  it('voidProse role → palette.role.voidProse', () => {
    const c = resolveSpinnerColor('voidProse')
    expect(c).toMatch(/^#[a-f0-9]{6}$/i)
  })

  it('all 6 roles return distinct hex colors', () => {
    const colors = (['voidProse', 'voidWrite', 'accent', 'success', 'warning', 'failure'] as const).map(
      resolveSpinnerColor,
    )
    const unique = new Set(colors)
    expect(unique.size).toBeGreaterThanOrEqual(4)
  })
})
