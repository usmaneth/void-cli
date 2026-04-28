import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { getPalette } from '../../theme/index.js'
import { GradientDivider } from './GradientDivider.js'

interface SemanticMarkerProps {
  type: 'user' | 'assistant' | 'system' | 'tool'
}

export function SemanticMarker({ type }: SemanticMarkerProps) {
  const palette = getPalette()
  const { columns } = useTerminalSize()
  const width = Math.max(10, columns - 4)

  if (type === 'user') {
    return (
      <Box flexDirection="row" width={width} paddingY={1} justifyContent="center">
        <Text dimColor color={palette.role.you}>─ USER INPUT ─</Text>
      </Box>
    )
  }

  if (type === 'assistant') {
    return (
      <Box flexDirection="column" width={width} paddingY={1}>
        <GradientDivider color={palette.role.voidProse} width={width} />
      </Box>
    )
  }

  if (type === 'tool') {
    return (
      <Box flexDirection="row" width={width} paddingY={1}>
        <Text dimColor color={palette.role.voidWrite}>⋯ SYSTEM OPERATION ⋯</Text>
      </Box>
    )
  }

  return null
}
