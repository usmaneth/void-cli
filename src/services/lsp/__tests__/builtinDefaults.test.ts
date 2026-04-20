/**
 * Tests for the LSP built-in defaults (per-language lazy spawn resolver).
 *
 * We avoid actually spawning language servers in CI: resolveBuiltinConfigForFile
 * goes through whichSync() which probes with `command -v`. Tests feature-detect
 * with a one-shot probe; when the host has no supported LSP installed, the
 * "integration" case is skipped. The pure routing / workspace-root / language
 * detection logic is always tested.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mod: typeof import('../builtinDefaults.js')

describe('LSP builtinDefaults', () => {
  beforeEach(async () => {
    process.env.VOID_LSP_SERVER = '1'
    vi.resetModules()
    mod = await import('../builtinDefaults.js')
    await mod._resetBuiltinsForTesting()
  })

  afterEach(async () => {
    await mod._resetBuiltinsForTesting()
  })

  it('maps .ts files to the typescript language definition', () => {
    const lang = mod.getLangForExtension('.ts')
    expect(lang).toBeDefined()
    expect(lang?.name).toBe('typescript')
  })

  it('maps .py / .rs / .go', () => {
    expect(mod.getLangForExtension('.py')?.name).toBe('python')
    expect(mod.getLangForExtension('.rs')?.name).toBe('rust')
    expect(mod.getLangForExtension('.go')?.name).toBe('go')
  })

  it('returns undefined for unsupported extensions', () => {
    expect(mod.getLangForExtension('.xyz')).toBeUndefined()
  })

  it('findWorkspaceRoot walks up to the nearest marker', () => {
    // Set up tmp tree:  <tmp>/root/{pkg.json, nested/a/b/file.ts}
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-root-'))
    const rootDir = path.join(tmp, 'root')
    const nested = path.join(rootDir, 'nested', 'a', 'b')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(rootDir, 'tsconfig.json'), '{}')

    const found = mod.findWorkspaceRoot(nested, ['tsconfig.json'], tmp)
    expect(found).toBe(rootDir)

    // Missing marker => undefined
    const missing = mod.findWorkspaceRoot(
      nested,
      ['nonexistent.toml'],
      tmp,
    )
    expect(missing).toBeUndefined()
  })

  it('listBuiltinLanguages describes extensions without spawning servers', () => {
    const langs = mod.listBuiltinLanguages()
    const names = langs.map(l => l.name).sort()
    expect(names).toEqual(['go', 'python', 'rust', 'typescript'])
    expect(
      langs.find(l => l.name === 'typescript')?.extensions,
    ).toContain('.ts')
  })

  it('feature-flag gate: getBuiltinServerForFile returns undefined when off', async () => {
    delete process.env.VOID_LSP_SERVER
    vi.resetModules()
    const fresh = await import('../builtinDefaults.js')
    expect(fresh.getBuiltinServerForFile('/tmp/x.ts')).toBeUndefined()
  })

  it('multi-language routing: different extensions hit different langs', () => {
    const paths = [
      '/tmp/x.ts',
      '/tmp/x.tsx',
      '/tmp/x.py',
      '/tmp/x.rs',
      '/tmp/x.go',
    ]
    const results = paths.map(p => mod.getLangForExtension(path.extname(p)))
    expect(results.map(r => r?.name)).toEqual([
      'typescript',
      'typescript',
      'python',
      'rust',
      'go',
    ])
  })
})
