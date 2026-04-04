/**
 * PromptStatusBar — compact one-line bar displayed above the prompt input.
 *
 * Shows model name, git branch, permission mode, and token budget usage.
 *
 * Format: claude-sonnet-4 · ⎇ main · ● auto · tok:[████░░]65%
 */
import * as React from 'react'
import { memo } from 'react'
import { getSdkBetas } from '../bootstrap/state.js'
import {
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../cost-tracker.js'
import { useMainLoopModel } from '../hooks/useMainLoopModel.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'
import { getContextWindowForModel } from '../utils/context.js'
import { renderModelName } from '../utils/model/model.js'

const FILLED = '█'
const EMPTY = '░'
const BAR_WIDTH = 6

function renderBar(percent: number): string {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  return FILLED.repeat(filled) + EMPTY.repeat(empty)
}

function getPermissionColor(
  mode: string | undefined,
): 'green' | 'yellow' | undefined {
  if (mode === 'auto') return 'green'
  if (mode === 'plan') return 'yellow'
  return undefined
}

function getPermissionLabel(mode: string | undefined): string {
  if (mode === 'auto') return 'auto'
  if (mode === 'plan') return 'plan'
  return 'ask'
}

type PromptStatusBarProps = {
  permissionMode?: string
  gitBranch?: string
}

function PromptStatusBarImpl({
  permissionMode,
  gitBranch,
}: PromptStatusBarProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const [_theme] = useTheme()
  const model = useMainLoopModel()

  const modelName = renderModelName(model)
  const contextWindowSize = getContextWindowForModel(model, getSdkBetas())
  const inputTokens = getTotalInputTokens()
  const outputTokens = getTotalOutputTokens()

  const usedTokens = inputTokens + outputTokens
  const tokenPercent = contextWindowSize > 0
    ? Math.min(100, Math.round((usedTokens / contextWindowSize) * 100))
    : 0
  const remaining = 100 - tokenPercent

  const permColor = getPermissionColor(permissionMode)
  const permLabel = getPermissionLabel(permissionMode)

  return (
    <Box paddingX={1}>
      <Text bold color="cyan">
        {modelName}
      </Text>

      {gitBranch ? (
        <>
          <Text dimColor>{' · '}</Text>
          <Text color="magenta">{'⎇ '}{gitBranch}</Text>
        </>
      ) : null}

      <Text dimColor>{' · '}</Text>
      <Text color={permColor}>{'● '}{permLabel}</Text>

      <Text dimColor>{' · '}</Text>
      <Text dimColor>tok:</Text>
      <Text color={tokenPercent >= 90 ? 'red' : tokenPercent >= 70 ? 'yellow' : 'green'}>
        [{renderBar(remaining)}]
      </Text>
      <Text color={tokenPercent >= 90 ? 'red' : tokenPercent >= 70 ? 'yellow' : 'green'}>
        {remaining}%
      </Text>
    </Box>
  )
}

export const PromptStatusBar = memo(PromptStatusBarImpl)
