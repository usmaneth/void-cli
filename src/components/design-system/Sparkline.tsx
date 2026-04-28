import * as React from 'react'
import { Text } from '../../ink.js'
import { getPalette } from '../../theme/index.js'

interface SparklineProps {
  data: number[]
  color?: string
}

const BRAILLE_CHARS = [' ', '⡀', '⡄', '⡆', '⡇', '⣇', '⣧', '⣷', '⣿']

export function Sparkline({ data, color }: SparklineProps) {
  const palette = getPalette()
  const resolvedColor = color ?? palette.brand.diamond
  if (!data || data.length === 0) return <Text color={resolvedColor}> </Text>
  
  const max = Math.max(...data, 1) // prevent division by zero
  const min = Math.min(...data)
  
  // Normalize and map to Braille chars
  const sparkline = data.map(val => {
    // If all values are the same, show a middle line
    if (max === min) return BRAILLE_CHARS[4]
    
    const normalized = (val - min) / (max - min)
    const index = Math.min(
      Math.floor(normalized * (BRAILLE_CHARS.length - 1)),
      BRAILLE_CHARS.length - 1
    )
    return BRAILLE_CHARS[index]
  }).join('')

  return <Text color={resolvedColor}>{sparkline}</Text>
}
