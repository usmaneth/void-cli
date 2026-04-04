import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import { Box, Text } from '../ink.js'

const PORTAL_FRAMES = [
  ['         ·         '],
  ['       · · ·       ', '      ·     ·      ', '       · · ·       '],
  ['      ░░░░░░░      ', '    ░░       ░░    ', '   ░░         ░░   ', '    ░░       ░░    ', '      ░░░░░░░      '],
  ['     ░░░░░░░░░     ', '   ░░▒▒▒▒▒▒▒░░    ', '  ░░▒▒       ▒▒░░  ', ' ░░▒▒         ▒▒░░ ', '  ░░▒▒       ▒▒░░  ', '   ░░▒▒▒▒▒▒▒░░    ', '     ░░░░░░░░░     '],
  ['     ░░░░░░░░░░░     ', '   ░░▒▒▓▓▓▓▓▒▒░░    ', '  ░░▒▓▓█████▓▓▒░░   ', ' ░░▒▓██     ██▓▒░░  ', ' ░░▒▓█       █▓▒░░  ', ' ░░▒▓██     ██▓▒░░  ', '  ░░▒▓▓█████▓▓▒░░   ', '   ░░▒▒▓▓▓▓▓▒▒░░    ', '     ░░░░░░░░░░░     '],
]

const TITLE_TEXT = 'V O I D'
const TAGLINE = 'the infinite agent'

// Safety timeout — if the animation doesn't complete in this time,
// force-call onComplete to prevent hanging.
const MAX_BOOT_TIME_MS = 5000

interface VoidBootSequenceProps {
  onComplete: () => void
  accentColor?: string
  showPortal?: boolean
}

export function VoidBootSequence({ onComplete, accentColor = '#8B5CF6', showPortal = true }: VoidBootSequenceProps) {
  const [frame, setFrame] = useState(0)
  const [showTitle, setShowTitle] = useState(false)
  const [showTagline, setShowTagline] = useState(false)
  // Use ref for onComplete to avoid stale closure issues
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

    const frameDelay = 200
    const totalFrames = PORTAL_FRAMES.length

    // Safety timeout to prevent hanging
    const safetyTimeout = setTimeout(safeComplete, MAX_BOOT_TIME_MS)

    const timer = setInterval(() => {
      setFrame((prev) => {
        const next = prev + 1
        if (next >= totalFrames) {
          clearInterval(timer)
          setShowTitle(true)
          setTimeout(() => {
            setShowTagline(true)
            setTimeout(safeComplete, 400)
          }, 300)
        }
        return Math.min(next, totalFrames - 1)
      })
    }, frameDelay)

    return () => {
      clearInterval(timer)
      clearTimeout(safetyTimeout)
    }
  }, [showPortal])

  const currentFrame = PORTAL_FRAMES[frame] ?? PORTAL_FRAMES[0]!

  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      {currentFrame.map((line, i) => (
        <Text key={i} color={accentColor}>{line}</Text>
      ))}
      {showTitle && (
        <Box marginTop={1}>
          <Text bold color={accentColor}>{TITLE_TEXT}</Text>
        </Box>
      )}
      {showTagline && (
        <Text dimColor>{TAGLINE}</Text>
      )}
    </Box>
  )
}
