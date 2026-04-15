import * as React from 'react'
import { Box, Text } from '../../ink.js'

interface ErrorCardProps {
  message: string
  code?: string
  action?: string
}

export function ErrorCard({ message, code, action }: ErrorCardProps) {
  // Try to parse out typical Error formats like "Error: <msg>" or "InputValidationError: <msg>"
  let displayCode = code ?? 'ERR_OPERATION_FAILED'
  let displayMessage = message
  
  if (!code && message.includes(':')) {
    const parts = message.split(':')
    if (parts[0] && parts[0].length < 30 && !parts[0].includes(' ')) {
      displayCode = parts[0]
      displayMessage = parts.slice(1).join(':').trim()
    }
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text color="error">✖</Text>
        <Text bold color="error">{displayCode}</Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        <Text>{displayMessage}</Text>
        {action && (
          <Box marginTop={1}>
            <Text dimColor>💡 {action}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
