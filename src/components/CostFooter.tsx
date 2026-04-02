/**
 * CostFooter — displays per-turn and session cost inline after every
 * assistant response. Designed to be compact and non-intrusive.
 *
 * Format: ─── model · 1,240 in / 380 out · $0.0062 · session $0.14 ───
 */
import * as React from 'react'
import { memo, useMemo } from 'react'
import {
  getTotalCost,
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../cost-tracker.js'
import { useMainLoopModel } from '../hooks/useMainLoopModel.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { renderModelName } from '../utils/model/model.js'

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(4)}`
  if (cost < 0.1) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

type CostFooterProps = {
  /** Input tokens for the latest turn (0 if unknown) */
  turnInputTokens?: number
  /** Output tokens for the latest turn (0 if unknown) */
  turnOutputTokens?: number
  /** USD cost for the latest turn (0 if unknown) */
  turnCost?: number
  /** Whether to show the footer (hidden when no API calls have been made) */
  visible?: boolean
}

function CostFooterImpl({
  turnInputTokens = 0,
  turnOutputTokens = 0,
  turnCost = 0,
  visible = true,
}: CostFooterProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const model = useMainLoopModel()

  const sessionCost = getTotalCost()
  const sessionInputTokens = getTotalInputTokens()
  const sessionOutputTokens = getTotalOutputTokens()

  // Don't render if no API calls have been made yet
  if (!visible || (sessionInputTokens === 0 && sessionOutputTokens === 0)) {
    return null
  }

  const modelName = renderModelName(model)
  const width = Math.min(columns, 120)

  // Build the info string
  const parts: string[] = []
  parts.push(modelName)

  if (turnInputTokens > 0 || turnOutputTokens > 0) {
    parts.push(
      `${formatTokenCount(turnInputTokens)} in / ${formatTokenCount(turnOutputTokens)} out`,
    )
  }

  if (turnCost > 0) {
    parts.push(formatUSD(turnCost))
  }

  parts.push(`session ${formatUSD(sessionCost)}`)

  const infoStr = parts.join(' · ')

  // Build the divider line with centered info
  const padding = 2 // paddingX on the parent
  const available = width - padding * 2
  const infoLen = infoStr.length + 2 // +2 for spaces around info
  const remainingDashes = Math.max(0, available - infoLen)
  const leftDashes = Math.floor(remainingDashes / 2)
  const rightDashes = remainingDashes - leftDashes

  const leftLine = '─'.repeat(Math.max(1, leftDashes))
  const rightLine = '─'.repeat(Math.max(1, rightDashes))

  return (
    <Box paddingX={2} marginTop={0}>
      <Text dimColor>
        {leftLine} {infoStr} {rightLine}
      </Text>
    </Box>
  )
}

export const CostFooter = memo(CostFooterImpl)
