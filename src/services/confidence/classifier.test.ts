import { describe, expect, it } from 'vitest'
import { classifySpan, type SpanColor } from './classifier.js'

describe('classifySpan', () => {
  it('hedge wins on plain hedge text', () => {
    expect(classifySpan('this might be the issue')).toBe<SpanColor>('hedge')
  })

  it('blocked wins on blocked text', () => {
    expect(classifySpan('manual verification needed')).toBe<SpanColor>('blocked')
  })

  it('confident wins on confident text', () => {
    expect(classifySpan('specifically the bug is here')).toBe<SpanColor>('confident')
  })

  it('codeRef wins when only code refs match', () => {
    expect(classifySpan('see api.ts for details')).toBe<SpanColor>('codeRef')
  })

  it('blocked beats hedge in same span', () => {
    expect(classifySpan('might be unable to proceed')).toBe<SpanColor>('blocked')
  })

  it('hedge + confident together → default (conflict signals ambiguity)', () => {
    expect(classifySpan('i think this is confirmed')).toBe<SpanColor>('default')
  })

  it('blocked + confident together → blocked (blocked is most severe)', () => {
    expect(classifySpan('the fix failed to apply')).toBe<SpanColor>('blocked')
  })

  it('default for plain prose with no markers', () => {
    expect(classifySpan('here is some neutral text')).toBe<SpanColor>('default')
  })

  it('empty string → default', () => {
    expect(classifySpan('')).toBe<SpanColor>('default')
  })
})
