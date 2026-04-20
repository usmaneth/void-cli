import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async (onDone) => {
  return (
    <Box flexDirection="column">
      <Text>Session browser: see <Text bold>SessionListDialog</Text> for the full UI.</Text>
      <Text dimColor>Wiring the session-row data source into /sessions is a follow-up.</Text>
    </Box>
  )
}
