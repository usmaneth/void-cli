import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { StructuredPatchHunk } from 'diff'
import {
  buildSplitRows,
  collapseContextRuns,
  computeSplitColumns,
  isDiffMode,
  parseHunkLines,
  renderSplitAscii,
  renderUnifiedAscii,
  resolveDiffMode,
  SPLIT_CONTEXT_COLLAPSE_THRESHOLD,
  SPLIT_MODE_MIN_COLUMNS,
  type SplitDiffRow,
} from '../diffMode.js'

// --- Fixtures --------------------------------------------------------------

function hunk(
  oldStart: number,
  newStart: number,
  lines: string[],
): StructuredPatchHunk {
  const oldLines = lines.filter(l => !l.startsWith('+')).length
  const newLines = lines.filter(l => !l.startsWith('-')).length
  return { oldStart, newStart, oldLines, newLines, lines }
}

const SMALL_DIFF = hunk(1, 1, [
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4',
])

const LARGE_DIFF = hunk(1, 1, [
  ' line1',
  ' line2',
  ' line3',
  ' line4',
  ' line5',
  ' line6',
  ' line7',
  ' line8',
  ' line9',
  ' line10',
  '-old line',
  '+new line',
  ' line11',
  ' line12',
  ' line13',
  ' line14',
  ' line15',
  ' line16',
  ' line17',
  ' line18',
])

const MULTI_CHANGE = hunk(1, 1, [
  ' context 1',
  '-remove 1',
  '-remove 2',
  '+add 1',
  '+add 2',
  '+add 3',
  ' context 2',
])

// --- resolveDiffMode -------------------------------------------------------

test('resolveDiffMode: auto picks split at ≥120 cols', () => {
  assert.equal(
    resolveDiffMode({ columns: SPLIT_MODE_MIN_COLUMNS }),
    'split',
  )
  assert.equal(resolveDiffMode({ columns: 120 }), 'split')
  assert.equal(resolveDiffMode({ columns: 200 }), 'split')
})

test('resolveDiffMode: auto picks unified below 120 cols', () => {
  assert.equal(
    resolveDiffMode({ columns: SPLIT_MODE_MIN_COLUMNS - 1 }),
    'unified',
  )
  assert.equal(resolveDiffMode({ columns: 80 }), 'unified')
  assert.equal(resolveDiffMode({ columns: 40 }), 'unified')
})

test('resolveDiffMode: explicit prop overrides setting and columns', () => {
  assert.equal(
    resolveDiffMode({ prop: 'split', setting: 'unified', columns: 40 }),
    'split',
  )
  assert.equal(
    resolveDiffMode({ prop: 'unified', setting: 'split', columns: 200 }),
    'unified',
  )
})

test('resolveDiffMode: setting overrides columns when prop is absent', () => {
  assert.equal(
    resolveDiffMode({ setting: 'split', columns: 40 }),
    'split',
  )
  assert.equal(
    resolveDiffMode({ setting: 'unified', columns: 200 }),
    'unified',
  )
})

test('resolveDiffMode: override trumps everything', () => {
  assert.equal(
    resolveDiffMode({
      override: 'unified',
      prop: 'split',
      setting: 'split',
      columns: 200,
    }),
    'unified',
  )
  assert.equal(
    resolveDiffMode({
      override: 'split',
      prop: 'unified',
      setting: 'unified',
      columns: 40,
    }),
    'split',
  )
})

test('resolveDiffMode: "auto" in any slot falls through to width rule', () => {
  assert.equal(
    resolveDiffMode({ prop: 'auto', setting: 'auto', columns: 119 }),
    'unified',
  )
  assert.equal(
    resolveDiffMode({ prop: 'auto', setting: 'auto', columns: 120 }),
    'split',
  )
})

test('resolveDiffMode: minColumns arg shifts the gate', () => {
  assert.equal(
    resolveDiffMode({ columns: 90, minColumns: 80 }),
    'split',
  )
  assert.equal(
    resolveDiffMode({ columns: 79, minColumns: 80 }),
    'unified',
  )
})

// --- isDiffMode ------------------------------------------------------------

test('isDiffMode: narrows to the three literal strings', () => {
  assert.equal(isDiffMode('split'), true)
  assert.equal(isDiffMode('unified'), true)
  assert.equal(isDiffMode('auto'), true)
  assert.equal(isDiffMode('SPLIT'), false)
  assert.equal(isDiffMode('side-by-side'), false)
  assert.equal(isDiffMode(undefined), false)
  assert.equal(isDiffMode(null), false)
})

// --- parseHunkLines --------------------------------------------------------

test('parseHunkLines: assigns correct absolute line numbers', () => {
  const parsed = parseHunkLines(SMALL_DIFF)
  assert.equal(parsed.length, 4)
  assert.deepEqual(parsed[0], {
    type: 'context',
    text: 'const a = 1',
    oldNum: 1,
    newNum: 1,
  })
  assert.deepEqual(parsed[1], {
    type: 'remove',
    text: 'const b = 2',
    oldNum: 2,
  })
  assert.deepEqual(parsed[2], {
    type: 'add',
    text: 'const b = 3',
    newNum: 2,
  })
  assert.deepEqual(parsed[3], {
    type: 'context',
    text: 'const c = 4',
    oldNum: 3,
    newNum: 3,
  })
})

// --- buildSplitRows --------------------------------------------------------

test('buildSplitRows: pairs adjacent remove/add lines', () => {
  const rows = buildSplitRows(SMALL_DIFF)
  assert.equal(rows.length, 3)
  // Context row
  assert.equal(rows[0]!.leftMarker, ' ')
  assert.equal(rows[0]!.rightMarker, ' ')
  assert.equal(rows[0]!.leftText, 'const a = 1')
  // Paired change row
  assert.equal(rows[1]!.leftMarker, '-')
  assert.equal(rows[1]!.rightMarker, '+')
  assert.equal(rows[1]!.leftText, 'const b = 2')
  assert.equal(rows[1]!.rightText, 'const b = 3')
  // Trailing context
  assert.equal(rows[2]!.leftText, 'const c = 4')
})

test('buildSplitRows: blanks out uneven remove/add counts', () => {
  const rows = buildSplitRows(MULTI_CHANGE)
  // 1 context + max(2,3)=3 paired rows + 1 context = 5
  assert.equal(rows.length, 5)
  // 3rd row (index 2): remove side is blank, add side filled
  const third = rows[3]!
  assert.equal(third.leftMarker, '')
  assert.equal(third.rightMarker, '+')
  assert.equal(third.leftText, '')
  assert.equal(third.rightText, 'add 3')
})

test('buildSplitRows: leading and trailing context are kept intact', () => {
  // LARGE_DIFF has 10 leading + 1 change + 8 trailing context rows. With
  // threshold=3 those are edges, not interior runs, so nothing collapses.
  const rows = buildSplitRows(LARGE_DIFF)
  assert.equal(
    rows.some(r => r.isEllipsis),
    false,
    'edge context must stay visible for anchoring',
  )
})

test('buildSplitRows: collapses long interior context to an ellipsis', () => {
  const interiorRuns = hunk(1, 1, [
    '-a',
    '+A',
    ' c1',
    ' c2',
    ' c3',
    ' c4',
    ' c5',
    ' c6',
    ' c7',
    ' c8',
    ' c9',
    '-b',
    '+B',
  ])
  const rows2 = buildSplitRows(interiorRuns)
  const hasEllipsis = rows2.some(r => r.isEllipsis)
  assert.equal(
    hasEllipsis,
    true,
    'expected interior run of 9 context lines to collapse',
  )
})

// --- collapseContextRuns ---------------------------------------------------

test('collapseContextRuns: preserves leading and trailing context', () => {
  const rows: SplitDiffRow[] = [
    ...makeCtx(1, 10),
    makePair(),
    ...makeCtx(12, 10),
  ]
  const out = collapseContextRuns(rows, 3)
  // Leading run stays. Change stays. Trailing run stays. No ellipsis.
  assert.equal(out.some(r => r.isEllipsis), false)
  assert.equal(out.length, rows.length)
})

test('collapseContextRuns: interior run > threshold*2+1 collapses', () => {
  const rows: SplitDiffRow[] = [
    makePair(),
    ...makeCtx(2, 10), // 10 interior context rows
    makePair(),
  ]
  const out = collapseContextRuns(rows, 3)
  const ellipsis = out.filter(r => r.isEllipsis)
  assert.equal(ellipsis.length, 1)
  // 1 change + 3 head + 1 ellipsis + 3 tail + 1 change = 9
  assert.equal(out.length, 9)
})

test('collapseContextRuns: interior run ≤ threshold*2+1 stays intact', () => {
  const rows: SplitDiffRow[] = [
    makePair(),
    ...makeCtx(2, 5), // threshold*2+1 = 7, so 5 stays
    makePair(),
  ]
  const out = collapseContextRuns(rows, 3)
  assert.equal(out.some(r => r.isEllipsis), false)
})

// --- computeSplitColumns ---------------------------------------------------

test('computeSplitColumns: splits width evenly across the two sides', () => {
  const rows = buildSplitRows(SMALL_DIFF)
  const cols = computeSplitColumns(rows, 120)
  const total =
    cols.leftGutter + cols.leftContent + 1 + cols.rightGutter + cols.rightContent
  assert.equal(total, 120)
})

test('computeSplitColumns: scales gutter to fit line numbers', () => {
  const big = hunk(9999, 9999, [
    ' a',
    '-b',
    '+B',
    ' c',
  ])
  const rows = buildSplitRows(big)
  const cols = computeSplitColumns(rows, 120)
  // 10001 → 5 digits + 3 = 8
  assert.ok(cols.leftGutter >= 8)
  assert.ok(cols.rightGutter >= 8)
})

test('computeSplitColumns: clamps width to a safe minimum', () => {
  const rows = buildSplitRows(SMALL_DIFF)
  const cols = computeSplitColumns(rows, 1)
  // Doesn't throw; content columns are at least 1
  assert.ok(cols.leftContent >= 1)
  assert.ok(cols.rightContent >= 1)
})

// --- renderSplitAscii ------------------------------------------------------

test('renderSplitAscii: small diff produces a pair of aligned columns', () => {
  const lines = renderSplitAscii(SMALL_DIFF, 120)
  assert.equal(lines.length, 3)
  for (const l of lines) {
    // separator present
    assert.ok(l.includes('│'), `expected separator in: ${JSON.stringify(l)}`)
    // width stays at 120 total
    assert.equal(l.length, 120)
  }
  // Change row: left shows '-' marker, right shows '+' marker
  const changeRow = lines[1]!
  assert.ok(
    changeRow.includes(' - '),
    `expected '-' marker in change row: ${changeRow}`,
  )
  assert.ok(
    changeRow.includes(' + '),
    `expected '+' marker in change row: ${changeRow}`,
  )
})

test('renderSplitAscii: large diff with interior run collapses to ellipsis', () => {
  const interiorRuns = hunk(1, 1, [
    '-a',
    '+A',
    ' c1',
    ' c2',
    ' c3',
    ' c4',
    ' c5',
    ' c6',
    ' c7',
    ' c8',
    ' c9',
    '-b',
    '+B',
  ])
  const lines = renderSplitAscii(interiorRuns, 120)
  assert.ok(
    lines.some(l => l.includes('…')),
    'expected ellipsis in collapsed output',
  )
})

// --- renderUnifiedAscii ----------------------------------------------------

test('renderUnifiedAscii: emits sigils and line numbers', () => {
  const out = renderUnifiedAscii(SMALL_DIFF, 60)
  assert.equal(out.length, 4)
  assert.ok(out[0]!.includes(' const a = 1'))
  assert.ok(out[1]!.includes('-const b = 2'))
  assert.ok(out[2]!.includes('+const b = 3'))
  assert.ok(out[3]!.includes(' const c = 4'))
})

test('renderUnifiedAscii: narrow widths clip content without throwing', () => {
  const out = renderUnifiedAscii(SMALL_DIFF, 10)
  assert.equal(out.length, 4)
  for (const line of out) {
    // each rendered line is at most the requested width (gutter + body)
    assert.ok(line.length <= 10, `expected ≤10 chars, got: ${line}`)
  }
})

// --- Setting override integration ------------------------------------------

test('resolveDiffMode + setting override: user sets "unified" at 200 cols', () => {
  // User explicitly pins unified even though split would be auto.
  assert.equal(
    resolveDiffMode({ setting: 'unified', columns: 200 }),
    'unified',
  )
})

test('resolveDiffMode + setting override: user sets "split" at 40 cols', () => {
  // User explicitly pins split even though terminal is narrow.
  // Setting honored; downstream renderer responsible for graceful handling.
  assert.equal(
    resolveDiffMode({ setting: 'split', columns: 40 }),
    'split',
  )
})

// --- helpers for test fixtures --------------------------------------------

function makeCtx(startLine: number, n: number): SplitDiffRow[] {
  const out: SplitDiffRow[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      leftNum: startLine + i,
      leftText: `c${i}`,
      leftMarker: ' ',
      rightNum: startLine + i,
      rightText: `c${i}`,
      rightMarker: ' ',
    })
  }
  return out
}

function makePair(): SplitDiffRow {
  return {
    leftNum: 999,
    leftText: 'removed',
    leftMarker: '-',
    rightNum: 999,
    rightText: 'added',
    rightMarker: '+',
  }
}

// Silence unused import warnings when threshold constant is unused elsewhere.
void SPLIT_CONTEXT_COLLAPSE_THRESHOLD
