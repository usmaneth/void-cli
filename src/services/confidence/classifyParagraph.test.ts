import { describe, expect, it } from 'vitest'
import {
  classifyParagraph,
  resolveRailColor,
  type ColoredSpan,
} from './classifyParagraph.js'

describe('classifyParagraph', () => {
  it('splits on punctuation boundaries', () => {
    const spans = classifyParagraph('hello world. this is a test')
    expect(spans.length).toBeGreaterThan(1)
  })

  it('every span has text + color', () => {
    const spans = classifyParagraph('hello world')
    for (const s of spans) {
      expect(typeof s.text).toBe('string')
      expect(['default', 'confident', 'codeRef', 'hedge', 'blocked']).toContain(s.color)
    }
  })

  it('hedge phrase span gets hedge color', () => {
    const spans = classifyParagraph('this might be a bug')
    const hedge = spans.find(s => s.color === 'hedge')
    expect(hedge).toBeDefined()
  })

  it('returns empty array for empty input', () => {
    expect(classifyParagraph('')).toEqual([])
  })

  it('preserves whitespace within spans', () => {
    const spans = classifyParagraph('a clear sentence')
    expect(spans.some(s => s.text.includes(' '))).toBe(true)
  })
})

describe('resolveRailColor', () => {
  it('any blocked span → blocked rail', () => {
    const spans: ColoredSpan[] = [
      { text: 'a', color: 'default' },
      { text: 'b', color: 'blocked' },
    ]
    expect(resolveRailColor(spans)).toBe('blocked')
  })

  it('any hedge (no blocked) → hedge rail', () => {
    const spans: ColoredSpan[] = [
      { text: 'a', color: 'default' },
      { text: 'b', color: 'hedge' },
    ]
    expect(resolveRailColor(spans)).toBe('hedge')
  })

  it('only confident + codeRef + default → confident rail', () => {
    const spans: ColoredSpan[] = [
      { text: 'a', color: 'confident' },
      { text: 'b', color: 'codeRef' },
      { text: 'c', color: 'default' },
    ]
    expect(resolveRailColor(spans)).toBe('confident')
  })

  it('all default → default rail', () => {
    const spans: ColoredSpan[] = [
      { text: 'a', color: 'default' },
    ]
    expect(resolveRailColor(spans)).toBe('default')
  })

  it('empty array → default', () => {
    expect(resolveRailColor([])).toBe('default')
  })
})
