import { describe, expect, it } from 'vitest'
import { heroSpaceModelName } from './heroSpaceModelName.js'

describe('heroSpaceModelName', () => {
  it('uppercases and inserts " · " between meaningful tokens', () => {
    expect(heroSpaceModelName('gpt-5.5')).toBe('G P T · 5 · 5')
    expect(heroSpaceModelName('claude-opus-4-7')).toBe('O P U S · 4 · 7')
    expect(heroSpaceModelName('gemini-3-pro')).toBe('G E M I N I · 3 · P R O')
    expect(heroSpaceModelName('grok-4')).toBe('G R O K · 4')
    expect(heroSpaceModelName('kimi-k2')).toBe('K I M I · K · 2')
  })

  it('strips date-style version suffixes', () => {
    expect(heroSpaceModelName('claude-opus-4-7-20260101')).toBe('O P U S · 4 · 7')
    expect(heroSpaceModelName('gpt-5.4-2026-03-05')).toBe('G P T · 5 · 4')
  })

  it('strips OpenRouter-style org prefixes', () => {
    expect(heroSpaceModelName('openrouter/anthropic/claude-sonnet-4-6')).toBe('S O N N E T · 4 · 6')
    expect(heroSpaceModelName('anthropic/claude-haiku-4-5')).toBe('H A I K U · 4 · 5')
  })

  it('letterspaces each character with a single space', () => {
    expect(heroSpaceModelName('grok')).toBe('G R O K')
  })

  it('drops claude/gpt/gemini/etc family prefixes when followed by a more specific token', () => {
    expect(heroSpaceModelName('claude-opus')).toBe('O P U S')
    expect(heroSpaceModelName('gpt-pro')).toBe('P R O')
    expect(heroSpaceModelName('gpt-5')).toBe('G P T · 5')
  })

  it('returns empty string for null/undefined/empty input', () => {
    expect(heroSpaceModelName('')).toBe('')
    expect(heroSpaceModelName(null)).toBe('')
    expect(heroSpaceModelName(undefined)).toBe('')
  })
})
