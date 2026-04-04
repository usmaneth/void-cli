import * as React from 'react'
import { memo } from 'react'
import { Box, Text } from '../ink.js'
import { renderSparkline } from './charts.js'
import { renderProgressBar } from './charts.js'

/**
 * Component that renders pre-formatted chart/diagram output.
 */
export const VisualBlock = memo(function VisualBlockImpl({
  content,
  title,
}: {
  content: string
  title?: string
}): React.ReactNode {
  return (
    <Box flexDirection="column" paddingX={1}>
      {title && <Text bold>{title}</Text>}
      <Text>{content}</Text>
    </Box>
  )
})

/**
 * Inline sparkline component.
 */
export const InlineSparkline = memo(function InlineSparklineImpl({
  values,
  label,
}: {
  values: number[]
  label?: string
}): React.ReactNode {
  const chart = renderSparkline(values)
  return (
    <Box>
      {label && <Text dimColor>{label}: </Text>}
      <Text color="cyan">{chart}</Text>
    </Box>
  )
})

/**
 * Progress bar component.
 */
export const ProgressDisplay = memo(function ProgressDisplayImpl({
  label,
  current,
  total,
  color,
}: {
  label: string
  current: number
  total: number
  color?: string
}): React.ReactNode {
  const bar = renderProgressBar({
    total,
    current,
    width: 30,
    label,
    showPercentage: true,
  })
  return <Text color={color}>{bar}</Text>
})
