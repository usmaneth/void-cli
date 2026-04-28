import { describe, expect, it } from 'vitest'
import { computeNextPhrase } from '../LoadingPhrase.js'
import { PHRASES } from '../phraseLibrary.js'

describe('computeNextPhrase', () => {
  it('rotates phrases without repeats in the recent window', () => {
    let recent: string[] = []
    const seen: string[] = []
    for (let i = 0; i < 30; i++) {
      const next = computeNextPhrase({ category: 'generic', lastFive: recent, seed: 0.5 })
      seen.push(next)
      recent = [next, ...recent].slice(0, 5)
    }
    expect(seen.length).toBe(30)
  })

  it('excludes the recent buffer from selection when the pool is large', () => {
    const recent = [...PHRASES.generic].slice(0, 5)
    for (let i = 0; i < 50; i++) {
      const next = computeNextPhrase({ category: 'generic', lastFive: recent, seed: Math.random() * 0.98 + 0.02 })
      expect(recent).not.toContain(next)
    }
  })
})
