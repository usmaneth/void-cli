import * as React from 'react'
import { Box, Text } from '../ink.js'

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
  borderColor = '#3F3F46',
  accentColor = '#8B5CF6',
  dimColor = '#71717A',
}: VoidStatusBarProps) {
  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1} marginTop={1} marginBottom={1}>
      <Text>
        <Text color={dimColor}>model: </Text>
        <Text color={accentColor}>{model}</Text>
        <Text color={dimColor}>  │  agents: </Text>
        <Text>{agents.active}/{agents.total}</Text>
        <Text color={dimColor}>  │  memory: </Text>
        <Text>{memoryNodes} nodes</Text>
        <Text color={dimColor}>  │  tools: </Text>
        <Text>{toolCount}</Text>
        <Text color={dimColor}>  │  v{version}</Text>
      </Text>
    </Box>
  )
}
