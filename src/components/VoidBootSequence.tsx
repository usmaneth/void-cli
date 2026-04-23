import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from '../ink.js'

// The new boot sequence treats the screen as a 4-phase cinematic:
//   1. Portal rings materialize (outer → inner), sparkles trail in.
//   2. Brand letters resolve in the center row of the portal.
//   3. Initialization checklist types out beneath, each item
//      streaming in with a tight stagger.
//   4. A single "operational" chime, then the sequence hands off.
//
// Entire sequence runs in ~2.6s and is capped at MAX_BOOT_TIME_MS to
// guarantee forward progress even if effects misfire.
const MAX_BOOT_TIME_MS = 4000

const PORTAL_ROWS: readonly string[] = [
  '       ·  ✦  ·       ',
  '    ·   ▲   ▲   ·    ',
  '    ·  ▲  ▼  ▲  ·    ',
  '   ·  ▲  ▼ ▼  ▲  ·   ',
  '  ◀ V · O · I · D ▶  ',
  '   ·  ▼  ▲ ▲  ▼  ·   ',
  '    ·  ▼  ▲  ▼  ·    ',
  '    ·   ▼   ▼   ·    ',
  '       ·  ✦  ·       ',
]
// Depth per row for materialization order (outer → inner → brand).
const ROW_DEPTH = [4, 3, 2, 1, 0, 1, 2, 3, 4]
const MAX_DEPTH = 4

const INIT_STEPS: readonly { label: string; value: string }[] = [
  { label: 'runtime', value: 'Ink · React 19' },
  { label: 'model', value: 'Opus 4.7 (1M)' },
  { label: 'tools', value: 'loaded' },
  { label: 'memory', value: 'synced' },
  { label: 'portal', value: 'open' },
]

interface VoidBootSequenceProps {
  onComplete: () => void
  accentColor?: string
  showPortal?: boolean
}

/**
 * First-run boot animation for the onboarding flow. Respects the bypass
 * path (`showPortal={false}`) so tests and headless startup skip it.
 */
export function VoidBootSequence({
  onComplete,
  showPortal = true,
}: VoidBootSequenceProps): React.ReactNode {
  const [materializeDepth, setMaterializeDepth] = useState(-1)
  const [stepIndex, setStepIndex] = useState(-1)
  const [operational, setOperational] = useState(false)

  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const safeComplete = (): void => {
    if (completedRef.current) return
    completedRef.current = true
    onCompleteRef.current()
  }

  useEffect(() => {
    if (!showPortal) {
      safeComplete()
      return
    }

    const safetyTimer = setTimeout(safeComplete, MAX_BOOT_TIME_MS)
    const timers: ReturnType<typeof setTimeout>[] = []
    const schedule = (ms: number, fn: () => void): void => {
      timers.push(setTimeout(fn, ms))
    }

    // Phase 1: portal materializes from outer depth 4 inward to 0.
    // Each ring lands 140ms apart → 5 × 140 = 700ms.
    const RING_MS = 140
    for (let d = MAX_DEPTH; d >= 0; d--) {
      schedule((MAX_DEPTH - d) * RING_MS, () =>
        setMaterializeDepth(d),
      )
    }

    // Phase 2+3: initialization steps stream in.
    const stepsStart = (MAX_DEPTH + 1) * RING_MS + 100
    for (let i = 0; i < INIT_STEPS.length; i++) {
      schedule(stepsStart + i * 160, () => setStepIndex(i))
    }

    // Phase 4: "operational" flash, then hand off.
    const opStart = stepsStart + INIT_STEPS.length * 160 + 180
    schedule(opStart, () => setOperational(true))
    schedule(opStart + 600, safeComplete)

    return () => {
      clearTimeout(safetyTimer)
      for (const t of timers) clearTimeout(t)
    }
  }, [showPortal])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} alignItems="center">
      <Box flexDirection="column" alignItems="center">
        {PORTAL_ROWS.map((row, i) => {
          const depth = ROW_DEPTH[i]!
          const visible = depth >= materializeDepth && materializeDepth >= 0
          if (!visible) {
            return (
              <Text key={i} color="claude">
                {' '.repeat(row.length)}
              </Text>
            )
          }
          if (depth === 0) {
            return (
              <Text key={i} bold color="claudeShimmer">
                {row}
              </Text>
            )
          }
          if (depth === MAX_DEPTH) {
            return (
              <Text key={i} color="claude" dimColor>
                {row}
              </Text>
            )
          }
          return (
            <Text key={i} color="claude">
              {row}
            </Text>
          )
        })}
      </Box>

      <Box flexDirection="column" marginTop={1} alignItems="flex-start">
        {INIT_STEPS.map((step, i) => {
          if (i > stepIndex) return null
          return (
            <Box key={i}>
              <Text color="claude">▸</Text>
              <Text dimColor>
                {' '}
                {step.label.padEnd(9, ' ')}{' '}
              </Text>
              <Text color="claudeShimmer">{step.value}</Text>
              <Text color="success">  ✓</Text>
            </Box>
          )
        })}
      </Box>

      {operational && (
        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text color="claudeShimmer" bold>
            portal stable · systems nominal
          </Text>
        </Box>
      )}
    </Box>
  )
}
