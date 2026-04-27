/**
 * Bundle locator: given a tool's binary path, return the file(s) we should
 * mine for string literals.
 *
 * Tools come in three shapes on this machine:
 *  1. **Native binary** (claude is bun-compile output, codex's platform pkg
 *     is rust-compile). Run `strings` to extract printable text.
 *  2. **JS source / shim** (codex's `bin/codex.js` is a node entrypoint
 *     stub). Read directly and regex out string literals.
 *  3. **Shell wrapper** (void's `bin/void` execs the TS entrypoint via
 *     bun). Walk up to find the source tree and mine the actual TS files.
 *
 * For each tool we return an ordered list of candidate sources — most
 * informative first. The caller mines all of them and merges the string
 * sets.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ToolName } from './types.js'

export type BundleSource =
  /** Read content directly as JS/TS text. Used for source files. */
  | { kind: 'text'; path: string }
  /** Run `strings -n MIN` to extract printable bytes. */
  | { kind: 'native'; path: string }
  /** A directory of source files; caller globs for `.ts`, `.tsx`, `.js`, `.mjs`. */
  | { kind: 'source-tree'; path: string }

/** Magic bytes for common native binary formats. */
const NATIVE_MAGIC: Array<{ bytes: number[]; label: string }> = [
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], label: 'mach-o-64' },
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], label: 'mach-o-64-rev' },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], label: 'mach-o-fat' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'elf' },
  { bytes: [0x4d, 0x5a], label: 'pe-windows' },
]

/** Read up to N bytes from a file, returning a Buffer. Never throws. */
function readHead(path: string, bytes = 16): Uint8Array | null {
  try {
    const buf = readFileSync(path)
    return buf.subarray(0, Math.min(bytes, buf.length))
  } catch {
    return null
  }
}

/** True if the file's leading bytes match a native-binary magic number. */
export function isNativeBinary(path: string): boolean {
  const head = readHead(path, 8)
  if (!head) return false
  for (const { bytes } of NATIVE_MAGIC) {
    if (head.length < bytes.length) continue
    let match = true
    for (let i = 0; i < bytes.length; i++) {
      if (head[i] !== bytes[i]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

/** True if the file appears to be a text script (starts with #! or printable ASCII). */
export function isScriptFile(path: string): boolean {
  if (isNativeBinary(path)) return false
  const head = readHead(path, 256)
  if (!head) return false
  // Reject if any null bytes in the first 256 — that's a binary signal.
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return false
  }
  return true
}

/**
 * Walk up from `start` looking for a directory that contains a `src/`
 * subdirectory. Used to locate void's source tree from the bash wrapper.
 * Returns null if nothing found within `maxDepth` levels.
 */
export function findSourceTreeRoot(
  start: string,
  maxDepth = 5,
): string | null {
  let dir = start
  try {
    if (statSync(dir).isFile()) dir = dirname(dir)
  } catch {
    return null
  }
  for (let i = 0; i < maxDepth; i++) {
    const candidate = join(dir, 'src')
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) return dir
      } catch {
        /* fallthrough */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * For a JS shim like codex's `bin/codex.js`, look for a sibling platform
 * package containing the real native binary. Returns the path or null.
 *
 * Walks the stub's `node_modules/@openai/codex-<platform>/vendor/.../codex`
 * convention. Tolerant — returns null on any miss.
 */
export function findCodexPlatformBinary(stubPath: string): string | null {
  const stubDir = dirname(stubPath)
  // Common layout: <pkg>/node_modules/@openai/codex-darwin-arm64/vendor/<triple>/codex/codex
  const pkgRoot = join(stubDir, '..')
  const platformDir = join(pkgRoot, 'node_modules', '@openai')
  if (!existsSync(platformDir)) return null
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    const entries = fs.readdirSync(platformDir)
    for (const entry of entries) {
      if (!entry.startsWith('codex-')) continue
      const vendorDir = join(platformDir, entry, 'vendor')
      if (!existsSync(vendorDir)) continue
      const tripleDirs = fs.readdirSync(vendorDir)
      for (const triple of tripleDirs) {
        const candidate = join(vendorDir, triple, 'codex', 'codex')
        if (existsSync(candidate) && isNativeBinary(candidate)) {
          return candidate
        }
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Resolve a binary path to its real target through any symlinks. Returns
 * the input unchanged if resolution fails.
 */
function resolveSymlink(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Locate one or more bundle sources to mine for a given tool.
 *
 * Returned in priority order — mine each, merge the resulting string
 * sets. Skips sources that don't exist.
 */
export function locateBundles(
  tool: ToolName,
  binary: string,
): BundleSource[] {
  const out: BundleSource[] = []
  const real = resolveSymlink(binary)

  if (tool === 'void') {
    // Void runs from TS source via the bash wrapper. Walk up to find the
    // src/ directory so we mine the actual codebase, not the wrapper.
    const root = findSourceTreeRoot(real)
    if (root) {
      out.push({ kind: 'source-tree', path: join(root, 'src') })
    } else if (isScriptFile(real)) {
      out.push({ kind: 'text', path: real })
    }
    return out
  }

  if (tool === 'claude') {
    // Claude's binary is bun-compile output: a Mach-O / ELF / PE with the
    // JS embedded in a custom segment. `strings` extracts everything,
    // including library noise — caller filters.
    if (isNativeBinary(real)) {
      out.push({ kind: 'native', path: real })
    } else if (isScriptFile(real)) {
      // Some installs ship a JS bundle directly. Read it as text.
      out.push({ kind: 'text', path: real })
    }
    return out
  }

  if (tool === 'codex') {
    // Codex's `bin/codex.js` is a thin stub that dispatches to the
    // platform-specific native binary. Mine both: the stub may have
    // stub-level strings, but the platform binary has the real content.
    if (isScriptFile(real)) {
      out.push({ kind: 'text', path: real })
      const platform = findCodexPlatformBinary(real)
      if (platform) out.push({ kind: 'native', path: platform })
    } else if (isNativeBinary(real)) {
      out.push({ kind: 'native', path: real })
    }
    return out
  }

  if (tool === 'opencode') {
    // No detection logic yet — return what we got. A real opencode user
    // can override with $OPENCODE_BIN; whatever that points to gets mined.
    if (isNativeBinary(real)) {
      out.push({ kind: 'native', path: real })
    } else if (isScriptFile(real)) {
      out.push({ kind: 'text', path: real })
    }
    return out
  }

  return out
}

/** Convenience for tests: turn relative paths into absolute. */
export function absoluteOf(p: string): string {
  return resolve(p)
}
