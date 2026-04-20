import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as path from 'node:path'
import { FileIndex } from '../../native-ts/file-index/index.js'
import { FrecencyStore } from '../frecency/store.js'
import { combineScores, getFileAutocompleteSync } from './files.js'

function makeIndex(paths: string[]): FileIndex {
  const idx = new FileIndex()
  idx.loadFromFileList(paths)
  return idx
}

describe('combineScores', () => {
  it('preserves fuzzy-only ordering when frecency is 0', () => {
    const s1 = combineScores(0.9, 0)
    const s2 = combineScores(0.5, 0)
    assert.ok(s1 > s2)
  })

  it('lets frecency break ties between equal fuzzy scores', () => {
    const plain = combineScores(0.5, 0)
    const frecent = combineScores(0.5, 2)
    assert.ok(frecent > plain)
  })

  it('frecencyBoost scales frecency influence', () => {
    const low = combineScores(0.5, 1, 0.5)
    const high = combineScores(0.5, 1, 5)
    assert.ok(high > low)
  })
})

describe('getFileAutocompleteSync', () => {
  const files = [
    'src/foo.ts',
    'src/bar.ts',
    'src/baz.test.ts',
    'src/components/Button.tsx',
    'src/components/Modal.tsx',
    'docs/intro.md',
  ]

  it('returns fuzzy matches when no frecency data', () => {
    const idx = makeIndex(files)
    const store = new FrecencyStore({ memoryOnly: true })
    const results = getFileAutocompleteSync('foo', idx, {
      frecencyStore: store,
    })
    assert.ok(results.length > 0)
    assert.equal(results[0]!.basename, 'foo.ts')
  })

  it('boosts a frecent file over equally-matching alternatives', () => {
    const idx = makeIndex(files)
    const store = new FrecencyStore({ memoryOnly: true })
    // Bump Modal repeatedly -- query "tsx" matches both Button and Modal
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      store.bump(path.resolve('src/components/Modal.tsx'), now - i * 1000)
    }
    const results = getFileAutocompleteSync('Modl', idx, {
      frecencyStore: store,
      cwd: process.cwd(),
    })
    assert.ok(results.length > 0)
    assert.equal(results[0]!.basename, 'Modal.tsx')
  })

  it('returns top frecent files on empty query', () => {
    const idx = makeIndex(files)
    const store = new FrecencyStore({ memoryOnly: true })
    store.bump(path.resolve('src/foo.ts'))
    store.bump(path.resolve('src/foo.ts'))
    store.bump(path.resolve('docs/intro.md'))
    const results = getFileAutocompleteSync('', idx, {
      frecencyStore: store,
      cwd: process.cwd(),
    })
    // Top result should be the more-frequently-accessed file
    assert.ok(results.length > 0)
    assert.equal(results[0]!.basename, 'foo.ts')
  })

  it('respects the limit', () => {
    const idx = makeIndex(files)
    const store = new FrecencyStore({ memoryOnly: true })
    const results = getFileAutocompleteSync('ts', idx, {
      frecencyStore: store,
      limit: 2,
    })
    assert.ok(results.length <= 2)
  })

  it('populates breadcrumb, icon, and language', () => {
    const idx = makeIndex(files)
    const store = new FrecencyStore({ memoryOnly: true })
    const results = getFileAutocompleteSync('Button', idx, {
      frecencyStore: store,
    })
    const hit = results.find(r => r.basename === 'Button.tsx')
    assert.ok(hit)
    assert.equal(hit!.breadcrumb, path.join('src', 'components'))
    assert.equal(hit!.icon, 'TSX')
    assert.equal(hit!.language, 'typescript')
  })

  it('returns a fuzzy match within a reasonable time on a 10k-path index', () => {
    const bigPaths: string[] = []
    for (let i = 0; i < 10_000; i++) {
      bigPaths.push(`src/pkg${i % 100}/module${i}.ts`)
    }
    const idx = makeIndex(bigPaths)
    const store = new FrecencyStore({ memoryOnly: true })
    const start = performance.now()
    const results = getFileAutocompleteSync('module500', idx, {
      frecencyStore: store,
    })
    const duration = performance.now() - start
    assert.ok(results.length > 0, 'expected at least one match')
    assert.ok(duration < 150, `expected <150ms, got ${duration.toFixed(1)}ms`)
  })
})
