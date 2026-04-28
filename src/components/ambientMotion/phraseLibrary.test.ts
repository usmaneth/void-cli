import { describe, expect, it } from 'vitest'
import {
  PHRASES,
  EASTER_EGGS,
  pickPhrase,
  type PhraseCategory,
} from './phraseLibrary.js'

describe('phraseLibrary data', () => {
  it('defines exactly 5 categories', () => {
    const expected: PhraseCategory[] = [
      'generic','bash','fileEdit','subagent','compaction',
    ]
    expect(Object.keys(PHRASES).sort()).toEqual(expected.sort())
  })

  it('generic has at least 10 phrases', () => {
    expect(PHRASES.generic.length).toBeGreaterThanOrEqual(10)
  })

  it('every category has at least 5 phrases', () => {
    for (const [cat, list] of Object.entries(PHRASES)) {
      expect(list.length, `${cat} should have ≥5 phrases`).toBeGreaterThanOrEqual(5)
    }
  })

  it('total phrases across categories ≥ 30', () => {
    const total = Object.values(PHRASES).reduce((sum, arr) => sum + arr.length, 0)
    expect(total).toBeGreaterThanOrEqual(30)
  })

  it('easter eggs has at least 5', () => {
    expect(EASTER_EGGS.length).toBeGreaterThanOrEqual(5)
  })
})

describe('pickPhrase', () => {
  it('returns a phrase from the requested category', () => {
    const phrase = pickPhrase({ category: 'bash', lastFive: [], easterEggSeed: 0.5 })
    expect(PHRASES.bash).toContain(phrase)
  })

  it('respects the no-repeat-within-5 buffer', () => {
    const recent = [...PHRASES.bash].slice(0, Math.min(4, PHRASES.bash.length))
    for (let i = 0; i < 50; i++) {
      const phrase = pickPhrase({ category: 'bash', lastFive: recent, easterEggSeed: Math.random() })
      if (PHRASES.bash.length > recent.length) {
        expect(recent).not.toContain(phrase)
      }
    }
  })

  it('returns an easter-egg phrase when seed is below 0.02 (~2%)', () => {
    const phrase = pickPhrase({ category: 'generic', lastFive: [], easterEggSeed: 0.01 })
    expect(EASTER_EGGS).toContain(phrase)
  })

  it('returns a category phrase when seed is above 0.02', () => {
    const phrase = pickPhrase({ category: 'generic', lastFive: [], easterEggSeed: 0.5 })
    expect(PHRASES.generic).toContain(phrase)
  })

  it('falls back to generic for unknown category', () => {
    const phrase = pickPhrase({
      category: 'unknownCategoryXYZ' as PhraseCategory,
      lastFive: [],
      easterEggSeed: 0.5,
    })
    expect(PHRASES.generic).toContain(phrase)
  })
})
