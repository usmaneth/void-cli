import { describe, expect, it } from 'vitest'
import { renderBarString } from '../ContextBar.js'

describe('ContextBar.renderBarString', () => {
  it('renders 0% as all-empty', () => {
    expect(renderBarString(0, 10)).toEqual({
      filled: '',
      empty: '▱▱▱▱▱▱▱▱▱▱',
    })
  })

  it('renders 50% as half-filled', () => {
    expect(renderBarString(0.5, 10)).toEqual({
      filled: '▰▰▰▰▰',
      empty: '▱▱▱▱▱',
    })
  })

  it('renders 100% as fully-filled', () => {
    expect(renderBarString(1.0, 10)).toEqual({
      filled: '▰▰▰▰▰▰▰▰▰▰',
      empty: '',
    })
  })

  it('clamps over-100% to fully-filled', () => {
    expect(renderBarString(1.5, 10)).toEqual({
      filled: '▰▰▰▰▰▰▰▰▰▰',
      empty: '',
    })
  })

  it('rounds correctly (35% on 10-cell width = 3.5 → 4 cells)', () => {
    expect(renderBarString(0.35, 10).filled.length).toBe(4)
  })

  it('respects custom widths', () => {
    expect(renderBarString(0.5, 20).filled.length).toBe(10)
    expect(renderBarString(0.5, 20).empty.length).toBe(10)
  })
})
