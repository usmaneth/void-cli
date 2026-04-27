/**
 * String-literal miner: extract "interesting" strings from each kind of
 * bundle source.
 *
 * The diff between claude's strings and void's strings drives /measure
 * suggest's port-plan output. To make that diff useful we need to mine
 * strings that look like *content* (prompt fragments, command names, error
 * messages, tool descriptions) rather than runtime/library noise (regex
 * engine internals, minified variable names, file paths inside
 * node_modules).
 *
 * This module is deliberately heuristic. The filters bias toward signal
 * over completeness: we'd rather miss a real candidate than drown the
 * report in 50,000 noise strings.
 */

import { spawn } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { BundleSource } from './bundleLocator.js'

/** Files we consider "source" when walking a source-tree. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

/** Directories to skip when walking a source tree. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.void',
  '.claude',
  '__tests__',
  'coverage',
  '.next',
  '.cache',
])

/** Per-string filter: returns true if a string is "interesting" enough to surface. */
export function isInterestingString(s: string): boolean {
  if (s.length < 20 || s.length > 800) return false

  // Density: at least 60% letters/digits/space/punctuation. Eliminates
  // binary garbage that occasionally leaks through `strings`.
  let printable = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 32 && c <= 126) || c === 10 || c === 13) printable++
  }
  if (printable / s.length < 0.95) return false

  // At least one space. Eliminates camelCase / snake_case identifiers,
  // stacktraces, and most variable-name garbage.
  if (!s.includes(' ')) return false

  // At least two letter-runs of length ≥3 (i.e., "two real words").
  // Cheap proxy for "looks like English/prose".
  const wordRuns = s.match(/[a-zA-Z]{3,}/g)
  if (!wordRuns || wordRuns.length < 2) return false

  // Reject strings that are mostly minified-code shape: lots of
  // semicolons, dollar signs, equals, parens. Those leak through `strings`
  // when the bundled JS has long expressions.
  const codeLikeChars = (s.match(/[;${}=()[\]<>\\]/g) ?? []).length
  if (codeLikeChars / s.length > 0.15) return false

  // Reject obvious file paths and URLs — those are usually shared between
  // tools and don't represent unique features.
  if (/^https?:\/\//i.test(s)) return false
  if (/^\/(usr|opt|bin|tmp|var|etc|System)\b/.test(s)) return false
  if (/\bnode_modules\b/.test(s)) return false
  if (/\bbuild\/release\b/.test(s)) return false
  if (s.includes('\u0000')) return false

  // Reject pure version specifiers / SemVer noise.
  if (/^[0-9.\s]+$/.test(s)) return false

  return true
}

/**
 * Extract string literals from JS/TS source text. Handles `"..."`,
 * `'...'`, and backtick template strings. Tolerates escapes; skips
 * strings inside comments? No — comments are stripped before regex via a
 * crude pass. (Cheap because we don't care about exact precision.)
 */
export function mineStringsFromText(text: string): string[] {
  // Strip line comments and block comments before scanning. Preserves
  // line breaks so byte offsets aren't catastrophically wrong.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))

  const out: string[] = []

  // Match double-quoted, single-quoted, and backtick strings. Use a
  // regex that handles escapes inside the string body.
  const re =
    /(?:"((?:\\.|[^"\\])*)")|(?:'((?:\\.|[^'\\])*)')|(?:`((?:\\.|[^`\\])*)`)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    if (!raw) continue
    // Cheap unescape: just turn the most common escapes into their
    // characters. Doesn't try to be perfect — close enough for diff.
    const decoded = raw
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
    if (isInterestingString(decoded)) out.push(decoded)
  }
  return out
}

/**
 * Run `strings -n 20 <path>` and return the matching lines. Used for
 * native binaries (claude's bun-compile output, codex's platform pkg).
 */
export async function mineStringsFromNative(
  path: string,
  minLen = 20,
  timeoutMs = 30_000,
): Promise<string[]> {
  return await new Promise(resolve => {
    let settled = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!settled) controller.abort()
    }, timeoutMs)

    let child: ReturnType<typeof spawn>
    try {
      child = spawn('strings', ['-n', String(minLen), path], {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: controller.signal,
      })
    } catch {
      clearTimeout(timer)
      settled = true
      resolve([])
      return
    }

    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      // Cap accumulation at 256MB to avoid pathological binaries.
      if (stdout.length < 256 * 1024 * 1024) stdout += chunk
    })
    child.stderr?.on('data', () => {})

    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve([])
    })

    child.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const lines = stdout
        .split('\n')
        .map(l => l.trimEnd())
        .filter(l => l.length > 0)
        .filter(isInterestingString)
      resolve(lines)
    })
  })
}

/** Recursively collect source files under a directory. Skips SKIP_DIRS. */
async function collectSourceFiles(
  root: string,
  out: string[],
  depth = 0,
): Promise<void> {
  if (depth > 10) return
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    if (entry.startsWith('.')) continue
    const full = join(root, entry)
    let s
    try {
      s = await stat(full)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      await collectSourceFiles(full, out, depth + 1)
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      out.push(full)
    }
  }
}

/**
 * Walk a source tree and mine string literals from every source file.
 * Skips node_modules, dist, build, .git etc — see SKIP_DIRS.
 */
export async function mineStringsFromSourceTree(
  root: string,
): Promise<string[]> {
  const files: string[] = []
  await collectSourceFiles(root, files)
  const all: string[] = []
  for (const file of files) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    all.push(...mineStringsFromText(text))
  }
  return all
}

/**
 * Mine a single bundle source. Dispatches to the right strategy based on
 * `kind`. Returns an array of "interesting" strings (already filtered).
 */
export async function mineBundleSource(
  source: BundleSource,
): Promise<string[]> {
  switch (source.kind) {
    case 'text': {
      try {
        const text = await readFile(source.path, 'utf8')
        return mineStringsFromText(text)
      } catch {
        return []
      }
    }
    case 'native':
      return mineStringsFromNative(source.path)
    case 'source-tree':
      return mineStringsFromSourceTree(source.path)
  }
}

/** Mine multiple bundle sources and return the union of their strings. */
export async function mineBundles(
  sources: BundleSource[],
): Promise<string[]> {
  const all: string[] = []
  for (const src of sources) {
    const got = await mineBundleSource(src)
    all.push(...got)
  }
  return all
}
