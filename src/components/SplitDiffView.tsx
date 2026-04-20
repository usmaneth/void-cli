import type { StructuredPatchHunk } from 'diff'
import * as React from 'react'
import { memo } from 'react'
import {
  buildSplitRows,
  computeSplitColumns,
  type SplitDiffRow,
} from '../utils/diffMode.js'
import { Box, NoSelect, Text } from '../ink.js'

type Props = {
  hunks: StructuredPatchHunk[]
  width: number
  dim?: boolean
}

/**
 * Side-by-side diff renderer. Each hunk becomes a block of rows. Each row
 * shows the "before" columns on the left and "after" columns on the
 * right, separated by a thin vertical separator. Unchanged context is
 * collapsed beyond a fixed threshold via buildSplitRows.
 *
 * This component is a pure consumer of diffMode utilities — it does not
 * do any syntax highlighting of its own (opencode parity: split view
 * prioritizes alignment and width-budget clarity over color richness).
 */
export const SplitDiffView = memo(function SplitDiffView({
  hunks,
  width,
  dim = false,
}: Props): React.ReactNode {
  if (hunks.length === 0) return null
  return (
    <Box flexDirection="column">
      {hunks.map((hunk, hunkIdx) => {
        const rows = buildSplitRows(hunk)
        const cols = computeSplitColumns(rows, width)
        return (
          <Box key={hunk.newStart} flexDirection="column">
            {hunkIdx > 0 ? (
              <NoSelect fromLeftEdge>
                <Text dimColor>...</Text>
              </NoSelect>
            ) : null}
            {rows.map((row, rowIdx) => (
              // @ts-ignore key prop (Void's ink/compiler types)
              <SplitDiffRowView key={rowIdx} row={row} cols={cols} dim={dim} />
            ))}
          </Box>
        )
      })}
    </Box>
  )
})

function SplitDiffRowView({
  row,
  cols,
  dim,
}: {
  row: SplitDiffRow
  cols: {
    leftGutter: number
    leftContent: number
    rightGutter: number
    rightContent: number
  }
  dim: boolean
}): React.ReactNode {
  if (row.isEllipsis) {
    const total = cols.leftGutter + cols.leftContent
    const totalRight = cols.rightGutter + cols.rightContent
    return (
      <Box flexDirection="row">
        <Text dimColor>{padRight('…', total)}</Text>
        <Text dimColor>│</Text>
        <Text dimColor>{padRight('…', totalRight)}</Text>
      </Box>
    )
  }

  const leftBg = row.leftMarker === '-'
    ? dim
      ? 'diffRemovedDimmed'
      : 'diffRemoved'
    : undefined
  const rightBg = row.rightMarker === '+'
    ? dim
      ? 'diffAddedDimmed'
      : 'diffAdded'
    : undefined

  return (
    <Box flexDirection="row">
      <NoSelect fromLeftEdge>
        <Text backgroundColor={leftBg} dimColor={dim}>
          {renderGutter(row.leftNum, row.leftMarker, cols.leftGutter)}
        </Text>
      </NoSelect>
      <Text backgroundColor={leftBg} dimColor={dim}>
        {clipPad(row.leftText, cols.leftContent)}
      </Text>
      <Text dimColor>│</Text>
      <NoSelect fromLeftEdge>
        <Text backgroundColor={rightBg} dimColor={dim}>
          {renderGutter(row.rightNum, row.rightMarker, cols.rightGutter)}
        </Text>
      </NoSelect>
      <Text backgroundColor={rightBg} dimColor={dim}>
        {clipPad(row.rightText, cols.rightContent)}
      </Text>
    </Box>
  )
}

function renderGutter(
  num: number | undefined,
  marker: '+' | '-' | ' ' | '',
  width: number,
): string {
  const numStr = num === undefined ? '' : String(num)
  const markerStr = marker === '' ? ' ' : marker
  const numWidth = Math.max(0, width - 3)
  return numStr.padStart(numWidth) + ' ' + markerStr + ' '
}

function clipPad(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length >= width) return text.slice(0, width)
  return text + ' '.repeat(width - text.length)
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text
  return text + ' '.repeat(width - text.length)
}
