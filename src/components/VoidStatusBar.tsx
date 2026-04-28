import * as React from 'react'
import { Box, Text } from '../ink.js'
import { getPalette } from '../theme/index.js'

interface VoidStatusBarProps {
  model: string
  agents?: { active: number; total: number }
  memoryNodes?: number
  toolCount?: number
  version?: string
  borderColor?: string
  accentColor?: string
  dimColor?: string
}

export function VoidStatusBar({
  model,
  agents = { active: 0, total: 0 },
  memoryNodes = 0,
  toolCount = 0,
  version = '0.1.0',
  borderColor,
  accentColor,
  dimColor,
}: VoidStatusBarProps) {
  const palette = getPalette()
  const resolvedBorder = borderColor ?? palette.text.dimmer
  const resolvedAccent = accentColor ?? palette.brand.accent
  const resolvedDim = dimColor ?? palette.text.dim
  return (
    <Box borderStyle="round" borderColor={resolvedBorder} paddingX={1} marginTop={1} marginBottom={1}>
      <Text>
        <Text color={resolvedDim}>model: </Text>
        <Text color={resolvedAccent}>{model}</Text>
        <Text color={resolvedDim}>  │  agents: </Text>
        <Text>{agents.active}/{agents.total}</Text>
        <Text color={resolvedDim}>  │  memory: </Text>
        <Text>{memoryNodes} nodes</Text>
        <Text color={resolvedDim}>  │  tools: </Text>
        <Text>{toolCount}</Text>
        <Text color={resolvedDim}>  │  v{version}</Text>
      </Text>
    </Box>
  )
}
