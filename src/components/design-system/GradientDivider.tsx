import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'

interface GradientDividerProps {
  color?: string
  width?: number | string
}

export function GradientDivider({ color = 'cyan', width = '100%' }: GradientDividerProps) {
  const { columns } = useTerminalSize()
  const w = typeof width === 'number' ? width : Math.max(10, columns - 2)
  
  // Fade out towards the edges: █▓▒░
  // Example for 10 cols: ░▒▓████▓▒░
  
  let pattern = ''
  if (w <= 8) {
    pattern = '█'.repeat(w)
  } else {
    const fade = ['░', '▒', '▓']
    const fadeLen = fade.length
    
    let leftFade = fade.join('')
    let rightFade = fade.slice().reverse().join('')
    let centerLen = w - (fadeLen * 2)
    
    if (centerLen < 0) {
      centerLen = 0
    }
    
    pattern = leftFade + '█'.repeat(centerLen) + rightFade
  }
  
  return (
    <Box width={width} paddingY={0} paddingX={1}>
      <Text dimColor color={color}>{pattern}</Text>
    </Box>
  )
}
