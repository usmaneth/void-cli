#!/usr/bin/env bun
/**
 * check-no-raw-colors.ts
 *
 * Lint rule: forbid raw color literals (hex like "#7dcfff" or named colors
 * like "cyan") outside the theme directory and a small set of legitimate
 * exceptions. After this rule lands, raw colors in component code become a
 * build error — anything color-related must go through the theme layer
 * (palette tokens, model accents, etc.).
 *
 * The rule fires on string literals only. To stay practical without
 * shelling out to a full TS parser we use a lightweight tokenizer that
 * understands single/double/back quotes and skips //, /* * /, and JSX
 * comments. This is good enough for the codebase's conventions and avoids
 * adding TypeScript compiler-API churn for a single check.
 *
 * Run: bun run scripts/check-no-raw-colors.ts [path1 path2 ...]
 *      (defaults to scanning src/ when no paths are given)
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — invocation/setup error
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_TARGET = join(ROOT, 'src')

const HEX_COLOR_RE = /^#([a-f0-9]{3}|[a-f0-9]{6})$/i
const NAMED_COLOR_RE =
  /^(black|red|green|yellow|blue|magenta|cyan|white|gray|grey|amber|violet|orange|pink|coral)$/i

// Paths that are allowed to contain raw color literals. Patterns are matched
// against the path relative to the worktree root, with forward-slash
// separators. A trailing "/**" matches any descendant.
//
// Note: src/__lint-fixtures__/** is intentionally NOT in this list —
// the fixture file is supposed to fail lint to prove the rule fires.
// Instead, the fixture dir is skipped during directory walking so it
// doesn't pollute the default full-source run, but explicit file paths
// (e.g. `bun run scripts/check-no-raw-colors.ts src/__lint-fixtures__/violations.tsx`)
// still report.
const EXEMPT_GLOBS = [
  'src/theme/**',
  'src/utils/theme.ts',
  'src/services/themes/**',
  'src/components/design-system/color.ts',
  'src/ink/colorize.ts',
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  'scripts/**',
]

// Directory names skipped during recursive walk. Files passed explicitly
// on the CLI bypass this filter.
const WALK_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '__lint-fixtures__',
])

// File extensions we lint. Everything else is skipped.
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

type Violation = {
  file: string
  line: number
  column: number
  literal: string
  kind: 'hex' | 'named'
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.replaceAll(sep, '/')
}

function globToRegex(glob: string): RegExp {
  // Handle the patterns we care about: literal segments, "*" within a
  // segment, and "**" across segments. Anchored at both ends.
  let re = '^'
  let i = 0
  while (i < glob.length) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      // Match zero or more path segments.
      re += '.*'
      i += 2
      // Eat a following "/" so "src/theme/**" matches "src/theme" itself too.
      if (glob[i] === '/') i += 1
      continue
    }
    if (ch === '*') {
      // Match within a single segment.
      re += '[^/]*'
      i += 1
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      i += 1
      continue
    }
    if (/[.+^$()|{}\\[\]]/.test(ch)) {
      re += '\\' + ch
      i += 1
      continue
    }
    re += ch
    i += 1
  }
  re += '$'
  return new RegExp(re)
}

const EXEMPT_RES = EXEMPT_GLOBS.map(globToRegex)

function isExempt(relPath: string): boolean {
  const posix = toPosix(relPath)
  return EXEMPT_RES.some((re) => re.test(posix))
}

function hasLintExtension(path: string): boolean {
  return EXTENSIONS.some((ext) => path.endsWith(ext))
}

/**
 * Walk a directory recursively and yield file paths that look like source
 * code. Skips node_modules, dist, .git, and similar.
 */
function* walk(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.git')) continue
    if (WALK_SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile() && hasLintExtension(entry.name)) {
      yield full
    }
  }
}

/**
 * Tokenize source into string literals. We track line/column positions
 * and skip over //-comments, /* * /-comments, and string-internal escapes.
 * Template literals (`...`) are tokenized too, but we only check the
 * raw text and don't attempt to evaluate ${...} interpolations — those
 * almost never contain literal color names.
 */
function* extractStringLiterals(
  source: string,
): Generator<{ value: string; line: number; column: number }> {
  let i = 0
  let line = 1
  let lineStart = 0
  const len = source.length

  while (i < len) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '\n') {
      line += 1
      lineStart = i + 1
      i += 1
      continue
    }

    // Line comment.
    if (ch === '/' && next === '/') {
      while (i < len && source[i] !== '\n') i += 1
      continue
    }

    // Block comment.
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          line += 1
          lineStart = i + 1
        }
        i += 1
      }
      i += 2
      continue
    }

    // String literal: ', ", or `.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      const startLine = line
      const startColumn = i - lineStart + 1
      i += 1
      let value = ''
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < len) {
          // Preserve the escape's logical meaning loosely. For the patterns
          // we match, the raw inner text is sufficient.
          value += source[i] + source[i + 1]
          if (source[i + 1] === '\n') {
            line += 1
            lineStart = i + 2
          }
          i += 2
          continue
        }
        if (source[i] === '\n') {
          line += 1
          lineStart = i + 1
        }
        value += source[i]
        i += 1
      }
      // Skip the closing quote (if present).
      if (i < len) i += 1
      yield { value, line: startLine, column: startColumn }
      continue
    }

    i += 1
  }
}

function checkFile(absPath: string): Violation[] {
  const relPath = relative(ROOT, absPath)
  if (isExempt(relPath)) return []

  let source: string
  try {
    source = readFileSync(absPath, 'utf8')
  } catch {
    return []
  }

  const violations: Violation[] = []
  for (const lit of extractStringLiterals(source)) {
    const trimmed = lit.value
    if (HEX_COLOR_RE.test(trimmed)) {
      violations.push({
        file: relPath,
        line: lit.line,
        column: lit.column,
        literal: trimmed,
        kind: 'hex',
      })
      continue
    }
    if (NAMED_COLOR_RE.test(trimmed)) {
      violations.push({
        file: relPath,
        line: lit.line,
        column: lit.column,
        literal: trimmed,
        kind: 'named',
      })
    }
  }
  return violations
}

function collectTargets(args: string[]): string[] {
  const explicit = args.length > 0 ? args : [DEFAULT_TARGET]
  const out: string[] = []
  for (const arg of explicit) {
    const abs = resolve(arg)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(abs)
    } catch {
      console.error(`check-no-raw-colors: path not found: ${arg}`)
      process.exit(2)
    }
    if (stat.isDirectory()) {
      for (const file of walk(abs)) out.push(file)
    } else if (stat.isFile() && hasLintExtension(abs)) {
      out.push(abs)
    }
  }
  return out
}

function main(): void {
  const args = process.argv.slice(2)
  const targets = collectTargets(args)

  const all: Violation[] = []
  for (const file of targets) {
    all.push(...checkFile(file))
  }

  if (all.length === 0) {
    console.log(`check-no-raw-colors: ok (${targets.length} files scanned)`)
    process.exit(0)
  }

  // Group by file for readable output.
  const byFile = new Map<string, Violation[]>()
  for (const v of all) {
    const list = byFile.get(v.file) ?? []
    list.push(v)
    byFile.set(v.file, list)
  }

  for (const [file, violations] of byFile) {
    for (const v of violations) {
      const label = v.kind === 'hex' ? 'hex color' : 'named color'
      console.error(
        `${file}:${v.line}:${v.column}  raw ${label} literal '${v.literal}' — use a theme token instead`,
      )
    }
  }

  console.error(
    `\ncheck-no-raw-colors: ${all.length} violation${all.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}`,
  )
  process.exit(1)
}

main()
