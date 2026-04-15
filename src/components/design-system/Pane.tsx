import React from 'react'
import { useIsInsideModal } from '../../context/modalContext.js'
import { Box } from '../../ink.js'
import type { Theme } from '../../utils/theme.js'

type PaneProps = {
  children: React.ReactNode
  color?: keyof Theme
}

export function Pane({ children, color = 'permission' }: PaneProps): React.ReactNode {
  if (useIsInsideModal()) {
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {children}
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor={color}
      marginTop={1}
    >
      {children}
    </Box>
  )
}
