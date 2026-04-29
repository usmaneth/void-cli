import { describe, expect, it } from 'vitest'
import {
  HEDGE_RE,
  BLOCKED_RE,
  CONFIDENT_RE,
  CODE_REF_RE,
} from './rules.js'

describe('HEDGE_RE', () => {
  const positives = [
    'might also', 'maybe', 'possibly', 'probably', 'perhaps',
    'seems to', 'seems like', 'appears to', 'likely',
    'i think', 'i believe', 'i guess', 'i suspect',
    'not sure', 'not 100% sure', 'not certain',
    "haven't traced", "haven't tested", "haven't verified",
    'kind of', 'sort of', 'roughly', 'approximately',
    'in theory', 'on the surface', 'at first glance',
    'untested', 'inferred',
  ]
  const negatives = [
    'definitely', 'absolutely', 'confirmed', 'tested and works',
  ]

  for (const p of positives) {
    it(`matches "${p}"`, () => {
      expect(HEDGE_RE.test(p)).toBe(true)
    })
  }
  for (const n of negatives) {
    it(`does not match "${n}"`, () => {
      expect(HEDGE_RE.test(n)).toBe(false)
    })
  }
})

describe('BLOCKED_RE', () => {
  it('matches blocked phrases', () => {
    expect(BLOCKED_RE.test('manual verification needed')).toBe(true)
    expect(BLOCKED_RE.test('failed to compile')).toBe(true)
    expect(BLOCKED_RE.test("can't proceed")).toBe(true)
    expect(BLOCKED_RE.test('cannot find file')).toBe(true)
    expect(BLOCKED_RE.test('unable to verify')).toBe(true)
    expect(BLOCKED_RE.test('not available')).toBe(true)
    expect(BLOCKED_RE.test('blocked')).toBe(true)
    expect(BLOCKED_RE.test('crashed')).toBe(true)
    expect(BLOCKED_RE.test('timed out')).toBe(true)
    expect(BLOCKED_RE.test('exceeded limit')).toBe(true)
  })

  it('does not match positive phrases', () => {
    expect(BLOCKED_RE.test('working on it')).toBe(false)
    expect(BLOCKED_RE.test('all tests pass')).toBe(false)
  })
})

describe('CONFIDENT_RE', () => {
  it('matches confident anchors', () => {
    expect(CONFIDENT_RE.test('specifically')).toBe(true)
    expect(CONFIDENT_RE.test('the fix:')).toBe(true)
    expect(CONFIDENT_RE.test('the bug is')).toBe(true)
    expect(CONFIDENT_RE.test('the issue is')).toBe(true)
    expect(CONFIDENT_RE.test('confirmed')).toBe(true)
    expect(CONFIDENT_RE.test('verified')).toBe(true)
    expect(CONFIDENT_RE.test('tested')).toBe(true)
    expect(CONFIDENT_RE.test('all tests pass')).toBe(true)
    expect(CONFIDENT_RE.test('done.')).toBe(true)
    expect(CONFIDENT_RE.test('complete.')).toBe(true)
    expect(CONFIDENT_RE.test('fixed.')).toBe(true)
  })
})

describe('CODE_REF_RE', () => {
  it('matches file refs', () => {
    expect(CODE_REF_RE.test('api.ts')).toBe(true)
    expect(CODE_REF_RE.test('src/components/foo.tsx')).toBe(true)
    expect(CODE_REF_RE.test('api.ts:142')).toBe(true)
    expect(CODE_REF_RE.test('package.json')).toBe(true)
  })

  it('does not match plain words', () => {
    expect(CODE_REF_RE.test('the')).toBe(false)
    expect(CODE_REF_RE.test('hello world')).toBe(false)
  })
})
