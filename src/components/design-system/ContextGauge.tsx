import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getPalette } from '../../theme/index.js'

interface ContextGaugeProps {
  percentage: number
  label?: string
}

export function ContextGauge({ percentage, label = 'ctx' }: ContextGaugeProps) {
  const palette = getPalette()
  // We want: [████████░░] 45% ctx
  const totalBlocks = 10
  const filledBlocks = Math.max(0, Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)))
  const emptyBlocks = totalBlocks - filledBlocks

  const filledChar = '█'
  const emptyChar = '░'

  const filledStr = filledChar.repeat(filledBlocks)
  const emptyStr = emptyChar.repeat(emptyBlocks)

  // Color zones: success -> warning -> failure
  let color = palette.state.success
  if (percentage >= 90) color = palette.state.failure
  else if (percentage >= 70) color = palette.state.warning
  
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>[</Text>
      <Text color={color}>{filledStr}</Text>
      <Text dimColor>{emptyStr}</Text>
      <Text dimColor>]</Text>
      <Text color={color}>{Math.round(percentage)}%</Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}
