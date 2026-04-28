import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getPalette } from '../../theme/index.js'

interface ToastProps {
  title: string
  message?: string
  icon?: string
  type?: 'success' | 'info' | 'warning'
}

export function Toast({ title, message, icon, type = 'success' }: ToastProps) {
  const palette = getPalette()
  const colorMap = {
    success: palette.state.success,
    info: palette.brand.diamond,
    warning: palette.state.warning,
  }
  
  const defaultIconMap = {
    success: '🏆',
    info: '💡',
    warning: '⚠️',
  }
  
  const displayIcon = icon ?? defaultIconMap[type]
  const color = colorMap[type]

  return (
    <Box flexDirection="row" borderStyle="round" borderColor={color} paddingX={1} gap={1}>
      <Text>{displayIcon}</Text>
      <Box flexDirection="column">
        <Text bold color={color}>{title}</Text>
        {message && <Text dimColor>{message}</Text>}
      </Box>
    </Box>
  )
}
