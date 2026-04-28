import { describe, expect, it } from 'vitest'
import {
  getPalette,
  MODEL_ACCENTS,
  resolveModelAccent,
} from '../index.js'

describe('theme entrypoint', () => {
  it('getPalette returns a populated palette object', () => {
    const p = getPalette()
    expect(p.brand.diamond).toBe('#7dcfff')
    expect(p.brand.accent).toBe('#bb9af7')
    expect(p.role.you).toBe('#bb9af7')
    expect(p.state.success).toBe('#9ece6a')
    expect(p.text.dim).toBe('#565f89')
  })

  it('re-exports model accent surface', () => {
    expect(MODEL_ACCENTS.anthropic).toBe('#7dcfff')
    expect(resolveModelAccent('claude-opus-4-7')).toBe('#7dcfff')
    expect(resolveModelAccent('gpt-5.5')).toBe('#bb9af7')
  })
})
