import { describe, expect, it } from 'vitest'
import { resolveIdleDiamondPeriod } from '../IdleDiamond.js'

describe('resolveIdleDiamondPeriod', () => {
  it('idle returns 2000ms', () => {
    expect(resolveIdleDiamondPeriod({ streamActive: false })).toBe(2000)
  })

  it('stream-active returns 500ms', () => {
    expect(resolveIdleDiamondPeriod({ streamActive: true })).toBe(500)
  })
})
