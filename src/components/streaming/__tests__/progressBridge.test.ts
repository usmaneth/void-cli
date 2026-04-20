/**
 * Unit tests for the progress→parts translation layer.
 *
 * Run with `node --test src/components/streaming/__tests__/progressBridge.test.ts`
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { progressToParts } from '../progressBridge.js'

describe('progressToParts - bash', () => {
  it('emits one bash_line part per line', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { lines: ['npm', 'install', 'done'] },
    })
    assert.equal(parts.length, 3)
    parts.forEach((p, i) => {
      assert.equal(p.kind, 'bash_line')
      assert.equal(p.sequence, i)
      assert.equal((p as any).text, ['npm', 'install', 'done'][i])
    })
  })

  it('marks lines as streaming when isIncomplete', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { lines: ['hi'], isIncomplete: true },
    })
    assert.equal(parts[0].state, 'streaming')
  })

  it('falls back to splitting raw stdout on newlines', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { stdout: 'a\nb\nc' },
    })
    assert.equal(parts.length, 3)
    assert.deepEqual(
      parts.map(p => (p as any).text),
      ['a', 'b', 'c'],
    )
  })
})

describe('progressToParts - read', () => {
  it('emits path part and then meta part when size is known', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { path: '/foo.ts', sizeBytes: 1234, lineCount: 42 },
    })
    assert.equal(parts.length, 2)
    assert.equal(parts[0].kind, 'read_path')
    assert.equal((parts[0] as any).path, '/foo.ts')
    assert.equal(parts[1].kind, 'read_meta')
    assert.equal((parts[1] as any).sizeBytes, 1234)
    assert.equal((parts[1] as any).lineCount, 42)
  })

  it('emits only the path part when meta is not yet known', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { path: '/foo.ts' },
    })
    assert.equal(parts.length, 1)
    assert.equal(parts[0].kind, 'read_path')
  })
})

describe('progressToParts - edit', () => {
  it('emits an edit_skeleton followed by hunks', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: {
        filePath: '/x.ts',
        hunks: [
          { before: 'old', after: 'new' },
          { before: 'bar', after: 'baz' },
        ],
      },
    })
    assert.equal(parts.length, 3)
    assert.equal(parts[0].kind, 'edit_skeleton')
    assert.equal((parts[0] as any).hunkCount, 2)
    assert.equal(parts[1].kind, 'edit_hunk')
    assert.equal((parts[1] as any).hunkIndex, 0)
    assert.equal((parts[2] as any).hunkIndex, 1)
  })

  it('does not double-match a read payload that also has path', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { path: '/a', kind: 'read' },
    })
    // Should not produce an edit_skeleton from this
    const kinds = parts.map(p => p.kind)
    assert.ok(kinds.includes('read_path'))
    assert.ok(!kinds.includes('edit_skeleton'))
  })
})

describe('progressToParts - search', () => {
  it('emits search_count on count progress', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { count: 42 },
    })
    assert.equal(parts.length, 1)
    assert.equal(parts[0].kind, 'search_count')
    assert.equal((parts[0] as any).total, 42)
  })

  it('accepts totalMatches as an alias for count', () => {
    const parts = progressToParts({
      toolUseID: 't1',
      data: { totalMatches: 7 },
    })
    assert.equal((parts[0] as any).total, 7)
  })
})

describe('progressToParts - unknown shapes', () => {
  it('returns empty for non-records', () => {
    assert.deepEqual(progressToParts({ toolUseID: 't', data: null }), [])
    assert.deepEqual(progressToParts({ toolUseID: 't', data: 42 }), [])
  })

  it('returns empty for records with no known fields', () => {
    assert.deepEqual(
      progressToParts({ toolUseID: 't', data: { random: 'junk' } }),
      [],
    )
  })
})
