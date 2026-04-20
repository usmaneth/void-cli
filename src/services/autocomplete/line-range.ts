/**
 * Line-range syntax parser for @-mentions.
 *
 * Accepted forms (all anchored at the end of a mention):
 *   @path/file.ts             -> { path: "path/file.ts" }
 *   @path/file.ts#L12         -> { path: "path/file.ts", startLine: 12 }
 *   @path/file.ts#L12-34      -> { path: "path/file.ts", startLine: 12, endLine: 34 }
 *   @path/file.ts#L12-        -> { path: "path/file.ts", startLine: 12 } (open-ended)
 *   @path/file.ts#L12:5-34:8  -> line + column (columns currently ignored but accepted)
 *
 * The `#L` marker is only treated as a line range when the suffix is numeric --
 * this keeps paths with `#` in them (rare but legal) safe.
 *
 * Pure functions only. No filesystem access -- integration happens in the
 * file-reference expander (see src/fileref/index.ts).
 */

export interface ParsedLineRange {
  /** Path as the user typed it, with the line-range suffix stripped. */
  path: string
  /** 1-indexed start line (inclusive). */
  startLine?: number
  /** 1-indexed end line (inclusive). Omitted for bare `#L12` or open-ended `#L12-`. */
  endLine?: number
  /** True when the user typed a `#L...` suffix. Useful for UI cues. */
  hasLineRange: boolean
}

// Matches `#L<start>[:<col>][-[<end>[:<col>]]]` at end of string.
const LINE_RANGE_RE = /#L(\d+)(?::(\d+))?(-)?(\d+)?(?::(\d+))?$/

/**
 * Parse a path-with-optional-line-range string.
 * Safe on plain paths (returns path unchanged, hasLineRange: false).
 * Leading `@` is stripped so this works on both "foo.ts#L1" and "@foo.ts#L1".
 */
export function parseLineRange(input: string): ParsedLineRange {
  const stripped = input.startsWith('@') ? input.slice(1) : input

  const match = LINE_RANGE_RE.exec(stripped)
  if (!match) {
    return { path: stripped, hasLineRange: false }
  }

  const startLineStr = match[1]!
  const dash = match[3]
  const endLineStr = match[4]

  const startLine = Number(startLineStr)
  if (!Number.isFinite(startLine) || startLine <= 0) {
    return { path: stripped, hasLineRange: false }
  }

  const pathOnly = stripped.slice(0, match.index)
  if (pathOnly.length === 0) {
    // Edge case: input was just "#L12" with no path -- not a line-range mention.
    return { path: stripped, hasLineRange: false }
  }

  let endLine: number | undefined
  if (endLineStr !== undefined) {
    const n = Number(endLineStr)
    if (Number.isFinite(n) && n >= startLine) {
      endLine = n
    }
    // end < start -> silently drop endLine (opencode does the same).
  } else if (dash === '-') {
    // open-ended; endLine stays undefined.
  }

  return {
    path: pathOnly,
    startLine,
    endLine,
    hasLineRange: true,
  }
}

/** Strip the line-range suffix from a query string for fuzzy matching. */
export function stripLineRange(input: string): string {
  const hashIdx = input.lastIndexOf('#')
  if (hashIdx === -1) return input
  if (!/^#L\d/.test(input.slice(hashIdx))) return input
  return input.slice(0, hashIdx)
}

/**
 * Extract the requested line slice from a file's full content.
 * Both bounds are 1-indexed and inclusive; values are clamped to [1, totalLines].
 * Returns null if range is clearly invalid (e.g. startLine > total lines).
 */
export function extractLines(
  content: string,
  startLine: number | undefined,
  endLine: number | undefined,
): { text: string; startLine: number; endLine: number } | null {
  if (startLine === undefined) return null
  const lines = content.split('\n')
  const total = lines.length
  if (startLine > total) return null
  const start = Math.max(1, startLine)
  const end = endLine === undefined ? total : Math.min(total, Math.max(start, endLine))
  const slice = lines.slice(start - 1, end).join('\n')
  return { text: slice, startLine: start, endLine: end }
}
