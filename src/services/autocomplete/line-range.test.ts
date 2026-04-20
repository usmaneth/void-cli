import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractLines, parseLineRange, stripLineRange } from './line-range.js'

describe('parseLineRange', () => {
  it('returns the raw path when there is no # suffix', () => {
    const r = parseLineRange('src/foo.ts')
    assert.equal(r.path, 'src/foo.ts')
    assert.equal(r.hasLineRange, false)
    assert.equal(r.startLine, undefined)
    assert.equal(r.endLine, undefined)
  })

  it('handles a leading @ prefix', () => {
    const r = parseLineRange('@src/foo.ts')
    assert.equal(r.path, 'src/foo.ts')
  })

  it('parses a single-line mention', () => {
    const r = parseLineRange('src/foo.ts#L12')
    assert.equal(r.path, 'src/foo.ts')
    assert.equal(r.startLine, 12)
    assert.equal(r.endLine, undefined)
    assert.equal(r.hasLineRange, true)
  })

  it('parses a closed range', () => {
    const r = parseLineRange('src/foo.ts#L12-34')
    assert.equal(r.path, 'src/foo.ts')
    assert.equal(r.startLine, 12)
    assert.equal(r.endLine, 34)
  })

  it('parses an open-ended range', () => {
    const r = parseLineRange('src/foo.ts#L12-')
    assert.equal(r.path, 'src/foo.ts')
    assert.equal(r.startLine, 12)
    assert.equal(r.endLine, undefined)
    assert.equal(r.hasLineRange, true)
  })

  it('accepts column suffixes (but ignores them)', () => {
    const r = parseLineRange('src/foo.ts#L12:5-34:8')
    assert.equal(r.path, 'src/foo.ts')
    assert.equal(r.startLine, 12)
    assert.equal(r.endLine, 34)
  })

  it('drops the end line when end < start', () => {
    const r = parseLineRange('src/foo.ts#L34-12')
    assert.equal(r.startLine, 34)
    assert.equal(r.endLine, undefined)
  })

  it('ignores # with non-numeric tail', () => {
    const r = parseLineRange('src/foo.ts#section-title')
    assert.equal(r.hasLineRange, false)
    assert.equal(r.path, 'src/foo.ts#section-title')
  })

  it('handles bare filename with line range (no directory)', () => {
    const r = parseLineRange('foo.ts#L5')
    assert.equal(r.path, 'foo.ts')
    assert.equal(r.startLine, 5)
  })

  it('rejects nonsensical zero line number', () => {
    const r = parseLineRange('foo.ts#L0')
    assert.equal(r.hasLineRange, false)
  })
})

describe('stripLineRange', () => {
  it('is a noop on plain paths', () => {
    assert.equal(stripLineRange('src/foo.ts'), 'src/foo.ts')
  })
  it('strips L-suffix', () => {
    assert.equal(stripLineRange('src/foo.ts#L12-34'), 'src/foo.ts')
  })
  it('leaves non-L hashes alone', () => {
    assert.equal(stripLineRange('foo.md#intro'), 'foo.md#intro')
  })
})

describe('extractLines', () => {
  const content = 'a\nb\nc\nd\ne'

  it('returns null when no startLine', () => {
    assert.equal(extractLines(content, undefined, undefined), null)
  })

  it('slices inclusive [start,end]', () => {
    const out = extractLines(content, 2, 4)
    assert.deepEqual(out, { text: 'b\nc\nd', startLine: 2, endLine: 4 })
  })

  it('treats missing endLine as open-ended (to end of file)', () => {
    const out = extractLines(content, 3, undefined)
    assert.deepEqual(out, { text: 'c\nd\ne', startLine: 3, endLine: 5 })
  })

  it('clamps out-of-bounds end to totalLines', () => {
    const out = extractLines(content, 4, 100)
    assert.deepEqual(out, { text: 'd\ne', startLine: 4, endLine: 5 })
  })

  it('returns null if startLine exceeds total', () => {
    assert.equal(extractLines(content, 999, undefined), null)
  })

  it('returns a single line when start == end', () => {
    const out = extractLines(content, 3, 3)
    assert.deepEqual(out, { text: 'c', startLine: 3, endLine: 3 })
  })
})
