/**
 * ResultBanner — the single-line banner used for terminal states
 * (rejected, canceled, failed) when no meaningful tool output exists.
 *
 * Replaces the per-state fragments scattered across
 * UserToolCanceledMessage, UserToolRejectMessage, and
 * FallbackToolUseErrorMessage — any future tool-result consumer can
 * drop this in instead of rolling its own one-line state message.
 */
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { ToolResultStatus } from './ToolResultView.js'

type Props = {
  status: ToolResultStatus
  /** Main banner text. */
  label: string
  /** Optional second-line detail, rendered dim. */
  detail?: string
}

const STATUS_GLYPH: Record<ToolResultStatus, string> = {
  success: '✓',
  error: '✗',
  warn: '!',
  rejected: '⊘',
  canceled: '⊘',
  running: '⋯',
}

const STATUS_COLOR: Record<ToolResultStatus, string> = {
  success: 'success',
  error: 'error',
  warn: 'warning',
  rejected: 'error',
  canceled: 'subtle',
  running: 'warning',
}

export function ResultBanner({
  status,
  label,
  detail,
}: Props): React.ReactNode {
  const color = STATUS_COLOR[status]
  const glyph = STATUS_GLYPH[status]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={color} bold>
          {glyph}
        </Text>
        <Text color={color}>{label}</Text>
      </Box>
      {detail && (
        <Box marginTop={detail.includes('\n') ? 1 : 0}>
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        </Box>
      )}
    </Box>
  )
}
