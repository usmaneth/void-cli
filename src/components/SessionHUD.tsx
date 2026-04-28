/**
 * SessionHUD — compact session health display inspired by oh-my-claudecode.
 *
 * Shows context window usage with visual bar, session duration, and rate
 * limit awareness. Designed as a single-line HUD element.
 *
 * Format: ctx:[████░░░░░░]67% · session:45m · $0.14
 */
import * as React from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { getSdkBetas } from '../bootstrap/state.js'
import {
  getTotalCost,
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../cost-tracker.js'
import { useMainLoopModel } from '../hooks/useMainLoopModel.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import {
  calculateContextPercentages,
  getContextWindowForModel,
} from '../utils/context.js'
import { renderModelName } from '../utils/model/model.js'
import { getCurrentUsage } from '../utils/tokens.js'
import { getPalette } from '../theme/index.js'
import type { Message } from '../types/message.js'
import { LspStatus } from './LspStatus.js'
import { ValidationStatus } from './ValidationStatus.js'

// Visual bar characters
const FILLED = '█'
const EMPTY = '░'
const BAR_WIDTH = 10

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h${remainingMinutes > 0 ? `${remainingMinutes}m` : ''}`
}

function formatUSD(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function getContextColor(
  percent: number,
  palette: ReturnType<typeof getPalette>,
): string {
  if (percent >= 90) return palette.state.failure
  if (percent >= 70) return palette.state.warning
  if (percent > 0) return palette.state.success
  return palette.text.dim
}

function getSessionHealthColor(
  minutes: number,
  contextPercent: number,
  palette: ReturnType<typeof getPalette>,
): string {
  // Red if context is critically full regardless of time
  if (contextPercent >= 90) return palette.state.failure
  // Yellow if session is getting long or context is filling
  if (minutes > 60 || contextPercent >= 70) return palette.state.warning
  return palette.state.success
}

function renderBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  return FILLED.repeat(filled) + EMPTY.repeat(empty)
}

type SessionHUDProps = {
  /** Messages array from REPL for context calculation */
  messages?: Array<{ role: string }>
  /** Whether the HUD should be visible */
  visible?: boolean
  /** Session start timestamp */
  sessionStartTime?: number
  /** Full transcript messages for derived segments (ValidationStatus). */
  transcript?: readonly Message[]
}

function SessionHUDImpl({
  visible = true,
  sessionStartTime,
  transcript,
}: SessionHUDProps): React.ReactNode {
  const palette = getPalette()
  const { columns } = useTerminalSize()
  const model = useMainLoopModel()
  const [now, setNow] = useState(Date.now())
  const startTimeRef = useRef(sessionStartTime ?? Date.now())

  // Hysteresis: prevent small context fluctuations from causing visual jitter
  const lastDisplayedPercentRef = useRef<number>(0)
  const lastUpdateTimeRef = useRef<number>(0)
  const HYSTERESIS_THRESHOLD = 2 // percent
  const HYSTERESIS_TTL = 5000 // ms

  // Update clock every 30s for session duration
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const sessionInputTokens = getTotalInputTokens()
  const sessionOutputTokens = getTotalOutputTokens()

  // Don't render if no API calls yet
  if (!visible || (sessionInputTokens === 0 && sessionOutputTokens === 0)) {
    return null
  }

  const sessionCost = getTotalCost()
  const modelName = renderModelName(model)
  const contextWindowSize = getContextWindowForModel(model, getSdkBetas())
  const currentUsage = getCurrentUsage([]) // Empty - we use token totals instead

  // Calculate context percentage from tracked tokens
  const rawContextPercent = Math.min(
    100,
    ((sessionInputTokens + sessionOutputTokens) / contextWindowSize) * 100,
  )

  // Apply hysteresis to prevent jitter
  let displayPercent: number
  const timeSinceLastUpdate = now - lastUpdateTimeRef.current
  if (
    Math.abs(rawContextPercent - lastDisplayedPercentRef.current) <
      HYSTERESIS_THRESHOLD &&
    timeSinceLastUpdate < HYSTERESIS_TTL
  ) {
    displayPercent = lastDisplayedPercentRef.current
  } else {
    displayPercent = Math.round(rawContextPercent)
    lastDisplayedPercentRef.current = displayPercent
    lastUpdateTimeRef.current = now
  }

  const sessionDuration = now - startTimeRef.current
  const sessionMinutes = Math.floor(sessionDuration / 60_000)

  const contextColor = getContextColor(displayPercent, palette)
  const sessionColor = getSessionHealthColor(sessionMinutes, displayPercent, palette)

  const width = Math.min(columns, 120)

  return (
    <Box paddingX={2}>
      <Text dimColor>{'─ '}</Text>
      <Text bold color={palette.brand.diamond}>
        {modelName}
      </Text>
      <Text dimColor>{' · '}</Text>
      <Text dimColor>ctx:</Text>
      <Text color={contextColor}>[{renderBar(displayPercent)}]</Text>
      <Text color={contextColor}>{displayPercent}%</Text>
      <Text dimColor>{' · '}</Text>
      <Text dimColor>tok:</Text>
      <Text>
        {formatTokenCount(sessionInputTokens)}↑{' '}
        {formatTokenCount(sessionOutputTokens)}↓
      </Text>
      <Text dimColor>{' · '}</Text>
      <Text color={sessionColor}>
        {formatDuration(sessionDuration)}
      </Text>
      <Text dimColor>{' · '}</Text>
      <Text color={sessionCost > 1 ? palette.state.warning : undefined}>
        {formatUSD(sessionCost)}
      </Text>
      <LspStatus />
      {transcript && <ValidationStatus messages={transcript} />}
      <Text dimColor>{' ─'}</Text>
    </Box>
  )
}

export const SessionHUD = memo(SessionHUDImpl)
