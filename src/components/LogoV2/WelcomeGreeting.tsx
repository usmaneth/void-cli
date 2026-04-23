import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from '../../ink.js'

// Rotating flavor text shown under the greeting. Each one reads in under a
// beat so it doesn't become visual noise. Kept deliberately short — a tiny
// bit of personality on startup, nothing more.
// Kept under 40 visible chars so they fit both the narrow compact box
// and the 50-col left panel without wrapping.
const SUBTITLES: readonly string[] = [
  'type  /  for commands   ·   @  for files',
  'the machine dreams in vectors',
  'bending spacetime, token by token',
  'ready when you are',
  'fold · compile · ascend',
  'the cursor ends, the void begins',
  'every line is a small act of will',
  'your deus ex machina awaits',
  'collapsing probabilities',
  'choose your ambition',
]

function pickSubtitle(): string {
  return SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)]!
}

type Props = {
  /**
   * The raw welcome message from `formatWelcomeMessage`, e.g. one of:
   *   "> welcome back, Usman"
   *   "> entering the void"
   */
  message: string
  /** When true, renders subtitle line underneath. Defaults to true. */
  showSubtitle?: boolean
}

/**
 * Splits the raw welcome message into decorated pieces:
 *   ◆ welcome back, Usman ◆
 * with the name accented in `claudeShimmer` and the rest bold. Falls back
 * to a plain bold render if the message doesn't match the expected shape.
 */
function renderDecorated(message: string): React.ReactNode {
  // Strip the leading "> " prompt marker if present.
  const core = message.startsWith('> ') ? message.slice(2) : message

  // Try "welcome back, <name>" → accent the name.
  const m = core.match(/^welcome back,\s+(.+)$/i)
  if (m) {
    return (
      <Text>
        <Text color="claude">◆ </Text>
        <Text bold>welcome back, </Text>
        <Text bold color="claudeShimmer">
          {m[1]}
        </Text>
        <Text color="claude"> ◆</Text>
      </Text>
    )
  }

  // Fallback (e.g. "entering the void") — decorate whole line.
  return (
    <Text>
      <Text color="claude">◆ </Text>
      <Text bold>{core}</Text>
      <Text color="claude"> ◆</Text>
    </Text>
  )
}

export function WelcomeGreeting({
  message,
  showSubtitle = true,
}: Props): React.ReactNode {
  // Pick a subtitle once on mount; re-picks on a fresh startup, not on
  // re-render.
  const [subtitle] = useState(pickSubtitle)

  return (
    <Box flexDirection="column" alignItems="center">
      {renderDecorated(message)}
      {showSubtitle && (
        <Text dimColor italic>
          {subtitle}
        </Text>
      )}
    </Box>
  )
}
