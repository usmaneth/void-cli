import type { StructuredPatchHunk } from 'diff'

/**
 * Rendering mode for diff hunks.
 * - 'split': side-by-side columns (before | after)
 * - 'unified': single column with +/- prefixes (git-style)
 * - 'auto': pick based on terminal width
 */
export type DiffMode = 'split' | 'unified' | 'auto'

/**
 * Terminal width threshold at which 'auto' prefers split view.
 * Matches opencode's behavior — at ≥120 cols the split columns have enough
 * room for ~55 cols of code per side after gutters, which is livable.
 */
export const SPLIT_MODE_MIN_COLUMNS = 120

/**
 * Collapse runs of unchanged context longer than this many lines to '…'
 * in split view. The full hunk is still contextually anchored by a couple
 * of lines at each end. Unified view preserves opencode/git behavior.
 */
export const SPLIT_CONTEXT_COLLAPSE_THRESHOLD = 3

export function isDiffMode(value: unknown): value is DiffMode {
  return value === 'split' || value === 'unified' || value === 'auto'
}

/**
 * Resolve the effective diff mode. Precedence:
 *   1. Explicit per-render override (Ctrl+D toggle).
 *   2. Per-prop mode (explicit caller prop).
 *   3. Settings value (user config).
 *   4. Fallback: 'auto'.
 *
 * When the resolved mode is 'auto', decide based on columns.
 */
export function resolveDiffMode({
  override,
  prop,
  setting,
  columns,
  minColumns = SPLIT_MODE_MIN_COLUMNS,
}: {
  override?: DiffMode
  prop?: DiffMode
  setting?: DiffMode
  columns: number
  minColumns?: number
}): 'split' | 'unified' {
  const chain: (DiffMode | undefined)[] = [override, prop, setting, 'auto']
  const chosen = chain.find(isDiffMode) ?? 'auto'
  if (chosen !== 'auto') return chosen
  return columns >= minColumns ? 'split' : 'unified'
}

/** One visual row in the split-diff rendering. */
export type SplitDiffRow = {
  /** The original line number on the left side (undefined for ellipsis / blank). */
  leftNum?: number
  /** The left-side line content with no marker, or empty for blank rows. */
  leftText: string
  /** Marker for left side: '-' for removal, ' ' for context, '' for blank. */
  leftMarker: '-' | ' ' | ''
  /** The new-side line number, undefined for ellipsis / blank rows. */
  rightNum?: number
  rightText: string
  rightMarker: '+' | ' ' | ''
  /** True when this row is an ellipsis marker for collapsed context. */
  isEllipsis?: boolean
}

type InternalLine = {
  type: 'add' | 'remove' | 'context'
  text: string
  oldNum?: number
  newNum?: number
}

/**
 * Parse a StructuredPatchHunk into a sequence of typed lines with
 * absolute line numbers attached. Line numbers skip removals on the
 * new side and skip additions on the old side — matching what Git
 * would show in a side-by-side view.
 */
export function parseHunkLines(hunk: StructuredPatchHunk): InternalLine[] {
  const out: InternalLine[] = []
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  for (const raw of hunk.lines) {
    if (raw.startsWith('+')) {
      out.push({ type: 'add', text: raw.slice(1), newNum: newLine })
      newLine++
    } else if (raw.startsWith('-')) {
      out.push({ type: 'remove', text: raw.slice(1), oldNum: oldLine })
      oldLine++
    } else {
      // Context lines start with ' ' or (in some edge cases) '\\' — treat as context.
      const body = raw.startsWith(' ') ? raw.slice(1) : raw
      out.push({
        type: 'context',
        text: body,
        oldNum: oldLine,
        newNum: newLine,
      })
      oldLine++
      newLine++
    }
  }
  return out
}

/**
 * Pair adjacent remove/add lines for side-by-side rendering.
 * - Context lines are emitted as left=context+right=context (same text).
 * - A run of N removes followed by M adds emits max(N,M) paired rows,
 *   with blanks filling the shorter side.
 * - Unmatched add/remove runs emit blank on the other side.
 *
 * Runs of >threshold consecutive context lines in the *middle* of the hunk
 * are collapsed into a single ellipsis row. Leading/trailing context up to
 * the threshold is kept so the hunk still has anchoring context.
 */
export function buildSplitRows(
  hunk: StructuredPatchHunk,
  collapseThreshold: number = SPLIT_CONTEXT_COLLAPSE_THRESHOLD,
): SplitDiffRow[] {
  const parsed = parseHunkLines(hunk)
  const paired: SplitDiffRow[] = []
  let i = 0
  while (i < parsed.length) {
    const line = parsed[i]!
    if (line.type === 'context') {
      paired.push({
        leftNum: line.oldNum,
        leftText: line.text,
        leftMarker: ' ',
        rightNum: line.newNum,
        rightText: line.text,
        rightMarker: ' ',
      })
      i++
      continue
    }
    // Collect the run of removes then adds.
    const removes: InternalLine[] = []
    while (i < parsed.length && parsed[i]!.type === 'remove') {
      removes.push(parsed[i]!)
      i++
    }
    const adds: InternalLine[] = []
    while (i < parsed.length && parsed[i]!.type === 'add') {
      adds.push(parsed[i]!)
      i++
    }
    const pairs = Math.max(removes.length, adds.length)
    for (let k = 0; k < pairs; k++) {
      const rm = removes[k]
      const ad = adds[k]
      paired.push({
        leftNum: rm?.oldNum,
        leftText: rm?.text ?? '',
        leftMarker: rm ? '-' : '',
        rightNum: ad?.newNum,
        rightText: ad?.text ?? '',
        rightMarker: ad ? '+' : '',
      })
    }
  }
  return collapseContextRuns(paired, collapseThreshold)
}

/**
 * Collapse interior runs of context rows longer than threshold into a
 * single ellipsis row. Preserves `threshold` context rows on each side
 * of the run so removed/added lines still have visible anchors.
 */
export function collapseContextRuns(
  rows: SplitDiffRow[],
  threshold: number,
): SplitDiffRow[] {
  if (threshold < 0) return rows
  const out: SplitDiffRow[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]!
    if (row.leftMarker !== ' ' || row.rightMarker !== ' ') {
      out.push(row)
      i++
      continue
    }
    // Start of a context run — find its extent.
    let runEnd = i
    while (
      runEnd < rows.length &&
      rows[runEnd]!.leftMarker === ' ' &&
      rows[runEnd]!.rightMarker === ' '
    ) {
      runEnd++
    }
    const runLength = runEnd - i
    // Leading run (before any change) OR trailing run (after last change) —
    // keep unchanged. Collapsing the edges would remove the context anchors.
    const isLeading = out.length === 0
    const isTrailing = runEnd >= rows.length
    if (isLeading || isTrailing || runLength <= threshold * 2 + 1) {
      for (let k = i; k < runEnd; k++) out.push(rows[k]!)
    } else {
      for (let k = i; k < i + threshold; k++) out.push(rows[k]!)
      out.push({
        leftText: '',
        leftMarker: '',
        rightText: '',
        rightMarker: '',
        isEllipsis: true,
      })
      for (let k = runEnd - threshold; k < runEnd; k++) out.push(rows[k]!)
    }
    i = runEnd
  }
  return out
}

/**
 * Compute the column widths used to render a split diff. Returns the
 * width for each of the four columns (left-gutter, left-content,
 * right-gutter, right-content). The left and right "halves" share
 * totalWidth equally — each half has a gutter (line# + marker + space)
 * plus content that fills the rest.
 */
export function computeSplitColumns(
  rows: SplitDiffRow[],
  totalWidth: number,
): {
  leftGutter: number
  leftContent: number
  rightGutter: number
  rightContent: number
} {
  const safeWidth = Math.max(4, Math.floor(totalWidth))
  const maxLeftNum = rows.reduce(
    (m, r) => Math.max(m, r.leftNum ?? 0),
    0,
  )
  const maxRightNum = rows.reduce(
    (m, r) => Math.max(m, r.rightNum ?? 0),
    0,
  )
  // gutter layout: "<num> <marker> " → digits + 1 + 1 + 1
  const leftGutter = Math.max(3, maxLeftNum.toString().length + 3)
  const rightGutter = Math.max(3, maxRightNum.toString().length + 3)
  // Split remaining width across the two content columns, minus 1 for
  // the column separator character.
  const remaining = Math.max(2, safeWidth - leftGutter - rightGutter - 1)
  const leftContent = Math.floor(remaining / 2)
  const rightContent = remaining - leftContent
  return { leftGutter, leftContent, rightGutter, rightContent }
}

/**
 * Format a single split row as a pair of side strings (pre-truncation).
 * The caller is responsible for wrapping or clipping to the column
 * widths. This is pure / ansi-free — used by both the Ink renderer and
 * the test suite's ASCII snapshot helper.
 */
export function formatSplitRow(
  row: SplitDiffRow,
  cols: {
    leftGutter: number
    leftContent: number
    rightGutter: number
    rightContent: number
  },
): { left: string; right: string } {
  if (row.isEllipsis) {
    return {
      left: padRight('…', cols.leftGutter + cols.leftContent),
      right: padRight('…', cols.rightGutter + cols.rightContent),
    }
  }
  const leftGutter = renderGutter(row.leftNum, row.leftMarker, cols.leftGutter)
  const rightGutter = renderGutter(
    row.rightNum,
    row.rightMarker,
    cols.rightGutter,
  )
  const left = leftGutter + clip(row.leftText, cols.leftContent)
  const right = rightGutter + clip(row.rightText, cols.rightContent)
  return {
    left: padRight(left, cols.leftGutter + cols.leftContent),
    right: padRight(right, cols.rightGutter + cols.rightContent),
  }
}

function renderGutter(
  num: number | undefined,
  marker: '+' | '-' | ' ' | '',
  width: number,
): string {
  const numStr = num === undefined ? '' : String(num)
  const markerStr = marker === '' ? ' ' : marker
  // layout: "<num padded-left> <marker> "
  // total = numWidth + 1 + 1 + 1 = numWidth + 3
  const numWidth = Math.max(0, width - 3)
  return numStr.padStart(numWidth) + ' ' + markerStr + ' '
}

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  return text.slice(0, width)
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text
  return text + ' '.repeat(width - text.length)
}

/**
 * Render a single hunk to plain-text split-view rows (ASCII only, no ANSI).
 * Used in tests and for copy-to-clipboard style output. The Ink component
 * (SplitDiffView) uses buildSplitRows + formatSplitRow directly so it can
 * colorize per row.
 */
export function renderSplitAscii(
  hunk: StructuredPatchHunk,
  width: number,
): string[] {
  const rows = buildSplitRows(hunk)
  const cols = computeSplitColumns(rows, width)
  return rows.map(r => {
    const { left, right } = formatSplitRow(r, cols)
    return left + '│' + right
  })
}

/**
 * Render a single hunk to plain-text unified rows (ASCII only). Mirrors
 * the StructuredDiffFallback output format: "<lineno> <sigil><code>".
 */
export function renderUnifiedAscii(
  hunk: StructuredPatchHunk,
  width: number,
): string[] {
  const parsed = parseHunkLines(hunk)
  const maxNum = parsed.reduce(
    (m, l) => Math.max(m, l.newNum ?? l.oldNum ?? 0),
    0,
  )
  const numWidth = Math.max(1, maxNum.toString().length)
  const contentWidth = Math.max(
    1,
    Math.floor(width) - numWidth - 2, // " " + sigil
  )
  return parsed.map(l => {
    const sigil = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' '
    const numStr = (
      l.type === 'add'
        ? String(l.newNum ?? '')
        : l.type === 'remove'
          ? String(l.oldNum ?? '')
          : String(l.newNum ?? l.oldNum ?? '')
    ).padStart(numWidth)
    const body = clip(l.text, contentWidth)
    return `${numStr} ${sigil}${body}`
  })
}
