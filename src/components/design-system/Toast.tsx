import * as React from 'react'
import { Box, Text } from '../../ink.js'

interface ToastProps {
  title: string
  message?: string
  icon?: string
  type?: 'success' | 'info' | 'warning'
}

export function Toast({ title, message, icon, type = 'success' }: ToastProps) {
  const colorMap = {
    success: 'green',
    info: 'cyan',
    warning: 'yellow',
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
