import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import { Box, Text } from '../ink.js'

const LOGO = [
  '  ██╗   ██╗ ██████╗ ██╗██████╗ ',
  '  ██║   ██║██╔═══██╗██║██╔══██╗',
  '  ██║   ██║██║   ██║██║██║  ██║',
  '  ╚██╗ ██╔╝██║   ██║██║██║  ██║',
  '   ╚████╔╝ ╚██████╔╝██║██████╔╝',
  '    ╚═══╝   ╚═════╝ ╚═╝╚═════╝ '
]

const DIVIDER = '▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓'

const INITIALIZATION_STEPS = [
  { label: '├─ Runtime ............', value: 'Ink v5.1' },
  { label: '├─ Model ..............', value: 'Opus 4.6' },
  { label: '├─ Context Window .....', value: '1M tokens' },
  { label: '├─ MCP Servers ........', value: '3 active' },
  { label: '├─ Tools ..............', value: '14 loaded' },
  { label: '├─ Memory .............', value: 'synced' },
  { label: '└─ Neural Link ........', value: 'READY' }
]

const MAX_BOOT_TIME_MS = 6000

interface VoidBootSequenceProps {
  onComplete: () => void
  accentColor?: string
  showPortal?: boolean
}

export function VoidBootSequence({ onComplete, accentColor = '#00E5FF', showPortal = true }: VoidBootSequenceProps) {
  const [phase, setPhase] = useState(0) // 0: Logo, 1: Init Core, 2: Steps, 3: Operational
  const [stepIndex, setStepIndex] = useState(-1)
  
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const completedRef = useRef(false)

  const safeComplete = () => {
    if (!completedRef.current) {
      completedRef.current = true
      onCompleteRef.current()
    }
  }

  useEffect(() => {
    if (!showPortal) {
      safeComplete()
      return
    }

    const safetyTimeout = setTimeout(safeComplete, MAX_BOOT_TIME_MS)

    const runSequence = async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      
      await delay(300) // Small delay before start
      setPhase(0)
      
      await delay(400) // Show logo
      setPhase(1)
      
      await delay(400) // Start steps
      setPhase(2)
      
      for (let i = 0; i < INITIALIZATION_STEPS.length; i++) {
        setStepIndex(i)
        await delay(150 + Math.random() * 100) // Staggered step appearance
      }
      
      await delay(400) // Finish steps
      setPhase(3)
      
      await delay(800) // Wait before completing
      safeComplete()
    }

    runSequence()

    return () => {
      clearTimeout(safetyTimeout)
    }
  }, [showPortal])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={accentColor}>{DIVIDER}</Text>
      {LOGO.map((line, i) => (
        <Text key={i} color={accentColor} bold>{line}</Text>
      ))}
      <Text color={accentColor}>{DIVIDER}</Text>
      
      <Box flexDirection="column" marginTop={1}>
        {phase >= 1 && (
          <Box marginBottom={1}>
            <Text color={accentColor}>  [INITIALIZING VOID NEURAL CORE...]</Text>
          </Box>
        )}
        
        {phase >= 2 && INITIALIZATION_STEPS.map((step, i) => {
          if (i > stepIndex) return null
          return (
            <Box key={i} paddingLeft={2}>
              <Text dimColor>{step.label} </Text>
              <Text color="gray">{step.value}  </Text>
              <Text color="green">✓</Text>
            </Box>
          )
        })}
      </Box>

      {phase >= 3 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Text color={accentColor} bold>⚡ All systems operational.</Text>
          <Text dimColor>Type to begin. ctrl+p for commands.</Text>
        </Box>
      )}
    </Box>
  )
}
