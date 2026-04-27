/**
 * Tests for the string miner. Focused on the filter heuristic and the
 * regex-based JS source extractor — those are the load-bearing pieces.
 * The native-binary path shells out to `strings` and is exercised
 * end-to-end by /measure suggest.
 */
import { describe, expect, it } from 'vitest'
import {
  isInterestingString,
  mineStringsFromText,
} from '../stringMiner.js'

describe('isInterestingString', () => {
  it('rejects strings shorter than 20 chars', () => {
    expect(isInterestingString('short string')).toBe(false)
  })

  it('rejects strings longer than 800 chars', () => {
    expect(isInterestingString('a '.repeat(500))).toBe(false)
  })

  it('rejects strings with no spaces (identifier-shape)', () => {
    expect(isInterestingString('camelCaseIdentifierWithNoSpaces')).toBe(false)
  })

  it('rejects strings with insufficient letter content', () => {
    expect(isInterestingString('1234 5678 9012 3456 7890 1234 5678 9012'))
      .toBe(false)
  })

  it('rejects file paths', () => {
    expect(
      isInterestingString('/usr/local/bin/tool somefile.txt content here'),
    ).toBe(false)
  })

  it('rejects URLs', () => {
    expect(
      isInterestingString('https://example.com/path/to/something with words'),
    ).toBe(false)
  })

  it('rejects strings that look like minified JS code', () => {
    expect(
      isInterestingString('var $a=function(b){return b.x;}; $a(c);  $b=true'),
    ).toBe(false)
  })

  it('rejects strings containing node_modules paths', () => {
    expect(
      isInterestingString(
        'compiled from node_modules/@scope/pkg/dist/index.js with options',
      ),
    ).toBe(false)
  })

  it('accepts a typical prompt sentence', () => {
    expect(
      isInterestingString(
        'You are an interactive agent that helps users with software engineering tasks',
      ),
    ).toBe(true)
  })

  it('accepts an instruction with imperative verbs', () => {
    expect(
      isInterestingString(
        'Always verify the diff before committing — do not skip review',
      ),
    ).toBe(true)
  })

  it('accepts a markdown heading line', () => {
    expect(
      isInterestingString('# Phase 1: Identify Changes that need review'),
    ).toBe(true)
  })

  it('rejects empty strings', () => {
    expect(isInterestingString('')).toBe(false)
  })
})

describe('mineStringsFromText', () => {
  it('extracts double-quoted strings', () => {
    const src = 'const a = "this is a real prompt about coding tasks"'
    const got = mineStringsFromText(src)
    expect(got).toContain('this is a real prompt about coding tasks')
  })

  it('extracts single-quoted strings', () => {
    const src = "const b = 'another long enough string with enough words here'"
    const got = mineStringsFromText(src)
    expect(got).toContain('another long enough string with enough words here')
  })

  it('extracts backtick template strings without interpolation', () => {
    const src = 'const c = `template literal with enough words for filter`'
    const got = mineStringsFromText(src)
    expect(got).toContain('template literal with enough words for filter')
  })

  it('decodes \\n inside string literals', () => {
    const src = String.raw`const d = "line one with words\nline two with words"`
    const got = mineStringsFromText(src)
    expect(got.some(s => s.includes('\n'))).toBe(true)
  })

  it('skips short strings', () => {
    const src = 'const e = "hi"'
    expect(mineStringsFromText(src)).toEqual([])
  })

  it('skips strings inside line comments', () => {
    const src =
      '// this is a comment with enough words to pass the filter normally\nconst f = 1'
    expect(mineStringsFromText(src)).toEqual([])
  })

  it('skips strings inside block comments', () => {
    const src =
      '/* "fake string in comment that would otherwise pass the filter" */\nconst g = 1'
    expect(mineStringsFromText(src)).toEqual([])
  })

  it('extracts multiple strings from a file', () => {
    const src = `
      const a = "first prompt that should be extracted from this code"
      const b = 'second prompt that should also pass through fine'
      const c = "tiny" // skipped — too short
    `
    const got = mineStringsFromText(src)
    expect(got).toHaveLength(2)
  })

  it('handles escaped quotes inside strings', () => {
    const src = String.raw`const a = "string with an escaped \"quote\" inside it for tests"`
    const got = mineStringsFromText(src)
    expect(got.some(s => s.includes('"quote"'))).toBe(true)
  })
})
