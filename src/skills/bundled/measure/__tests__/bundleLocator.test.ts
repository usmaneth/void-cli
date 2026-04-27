/**
 * Tests for bundle locator. Pure functions tested directly; filesystem
 * branches use a temp directory.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findSourceTreeRoot,
  isNativeBinary,
  isScriptFile,
  locateBundles,
} from '../bundleLocator.js'

describe('isNativeBinary', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bundle-loc-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('detects Mach-O 64-bit (claude / codex platform binary)', () => {
    const path = join(tmp, 'macho')
    writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
    expect(isNativeBinary(path)).toBe(true)
  })

  it('detects Mach-O 64-bit reversed', () => {
    const path = join(tmp, 'macho-rev')
    writeFileSync(path, Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]))
    expect(isNativeBinary(path)).toBe(true)
  })

  it('detects ELF', () => {
    const path = join(tmp, 'elf')
    writeFileSync(path, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]))
    expect(isNativeBinary(path)).toBe(true)
  })

  it('returns false for a JS source file', () => {
    const path = join(tmp, 'script.js')
    writeFileSync(path, '#!/usr/bin/env node\nconsole.log("hi")\n')
    expect(isNativeBinary(path)).toBe(false)
  })

  it('returns false for a missing file', () => {
    expect(isNativeBinary(join(tmp, 'does-not-exist'))).toBe(false)
  })
})

describe('isScriptFile', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bundle-loc-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns true for a #! shebang script', () => {
    const path = join(tmp, 'a.js')
    writeFileSync(path, '#!/usr/bin/env node\nlet x = 1\n')
    expect(isScriptFile(path)).toBe(true)
  })

  it('returns false for a Mach-O binary (null bytes in head)', () => {
    const path = join(tmp, 'm')
    writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
    expect(isScriptFile(path)).toBe(false)
  })

  it('returns false for a missing file', () => {
    expect(isScriptFile(join(tmp, 'nope'))).toBe(false)
  })
})

describe('findSourceTreeRoot', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bundle-loc-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns the directory containing src/ when found at start', () => {
    mkdirSync(join(tmp, 'src'))
    expect(findSourceTreeRoot(tmp)).toBe(tmp)
  })

  it('walks up from a file until it finds src/', () => {
    mkdirSync(join(tmp, 'src'))
    mkdirSync(join(tmp, 'bin'))
    const wrapper = join(tmp, 'bin', 'tool')
    writeFileSync(wrapper, '#!/bin/sh\nexec node ../src/cli.js')
    expect(findSourceTreeRoot(wrapper)).toBe(tmp)
  })

  it('returns null when no src/ found within depth', () => {
    expect(findSourceTreeRoot(tmp)).toBeNull()
  })
})

describe('locateBundles', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bundle-loc-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('void: returns a source-tree pointer when src/ is found', () => {
    mkdirSync(join(tmp, 'src'))
    mkdirSync(join(tmp, 'bin'))
    const wrapper = join(tmp, 'bin', 'void')
    writeFileSync(wrapper, '#!/bin/sh\nexec bun src/cli.tsx')
    // macOS resolves /var/folders/... to /private/var/folders/... via
    // realpath; locateBundles applies that resolution internally so the
    // expected path goes through the same canonicalization.
    const realTmp = realpathSync(tmp)
    const got = locateBundles('void', wrapper)
    expect(got).toHaveLength(1)
    expect(got[0]!.kind).toBe('source-tree')
    expect(got[0]!.path).toBe(join(realTmp, 'src'))
  })

  it('claude: returns a native pointer when binary has Mach-O magic', () => {
    const path = join(tmp, 'claude')
    writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
    const got = locateBundles('claude', path)
    expect(got).toHaveLength(1)
    expect(got[0]!.kind).toBe('native')
  })

  it('codex: returns text pointer for the JS stub', () => {
    const path = join(tmp, 'codex.js')
    writeFileSync(path, '#!/usr/bin/env node\nconst PLATFORM = ...\n')
    const got = locateBundles('codex', path)
    expect(got.length).toBeGreaterThanOrEqual(1)
    expect(got[0]!.kind).toBe('text')
  })

  it('opencode: returns nothing when binary path does not exist', () => {
    expect(locateBundles('opencode', join(tmp, 'nope'))).toEqual([])
  })
})
