import * as React from 'react'
import { Box, Text } from '../../ink.js'

interface ContextGaugeProps {
  percentage: number
  label?: string
}

export function ContextGauge({ percentage, label = 'ctx' }: ContextGaugeProps) {
  // We want: [████████░░] 45% ctx
  const totalBlocks = 10
  const filledBlocks = Math.max(0, Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)))
  const emptyBlocks = totalBlocks - filledBlocks
  
  const filledChar = '█'
  const emptyChar = '░'
  
  const filledStr = filledChar.repeat(filledBlocks)
  const emptyStr = emptyChar.repeat(emptyBlocks)
  
  // Color zones: green -> yellow -> red
  let color = 'green'
  if (percentage >= 90) color = 'red'
  else if (percentage >= 70) color = 'yellow'
  
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
