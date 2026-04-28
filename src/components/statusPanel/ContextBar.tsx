/**
 * Filled/empty progress bar for context usage. Color via
 * resolveContextBarColor (cyan / amber / red gradient at 0.4 / 0.7).
 * Empty cells render in palette.text.dimmer.
 */
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getPalette } from '../../theme/index.js'
import { resolveContextBarColor } from './contextBarColor.js'

const FILLED = '▰'
const EMPTY = '▱'

export type ContextBarProps = {
  ratio: number
  width: number
}

export function renderBarString(
  ratio: number,
  width: number,
): { filled: string; empty: string } {
  const r = Math.max(0, Math.min(1, ratio))
  const filledCells = Math.round(r * width)
  return {
    filled: FILLED.repeat(filledCells),
    empty: EMPTY.repeat(width - filledCells),
  }
}

export function ContextBar({ ratio, width }: ContextBarProps): React.ReactNode {
  const palette = getPalette()
  const color = resolveContextBarColor(ratio)
  const { filled, empty } = renderBarString(ratio, width)
  return (
    <Box>
      {filled.length > 0 && <Text color={color}>{filled}</Text>}
      {empty.length > 0 && <Text color={palette.text.dimmer}>{empty}</Text>}
    </Box>
  )
}
