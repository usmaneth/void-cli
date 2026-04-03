import * as React from 'react'
import { memo } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'

// ── Gutter colors by message type ──────────────────────────────────────────

const GUTTER_COLORS: Record<string, string> = {
  assistant: 'blue',
  user: 'green',
  system: 'yellow',
  tool: 'cyan',
  error: 'red',
}

export function getGutterColor(type: string): string {
  return GUTTER_COLORS[type] ?? 'gray'
}

// ── MessageGutter ──────────────────────────────────────────────────────────

type GutterType = 'assistant' | 'user' | 'system' | 'tool' | 'error'

type MessageGutterProps = {
  type: GutterType
  children: React.ReactNode
}

const GUTTER_CHAR = '│'

function MessageGutterImpl({ type, children }: MessageGutterProps) {
  const color = getGutterColor(type)
  const dimmed = type === 'system'

  return (
    <Box flexDirection="row">
      <Text color={color} dimColor={dimmed}>
        {GUTTER_CHAR}
      </Text>
      <Text> </Text>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  )
}

export const MessageGutter = memo(MessageGutterImpl)
MessageGutter.displayName = 'MessageGutter'

// ── MessageDivider ─────────────────────────────────────────────────────────

type MessageDividerProps = {
  label?: string
}

const DIVIDER_CHAR = '─'

function MessageDividerImpl({ label }: MessageDividerProps) {
  const { columns } = useTerminalSize()
  const [theme] = useTheme()

  // Reserve some margin so we don't overflow
  const availableWidth = Math.max(columns - 4, 10)

  if (label) {
    const labelWithPadding = ` ${label} `
    const remaining = availableWidth - labelWithPadding.length
    const leftLen = Math.max(Math.floor(remaining / 2), 1)
    const rightLen = Math.max(remaining - leftLen, 1)
    const left = DIVIDER_CHAR.repeat(leftLen)
    const right = DIVIDER_CHAR.repeat(rightLen)

    return (
      <Box>
        <Text dimColor>{left}{labelWithPadding}{right}</Text>
      </Box>
    )
  }

  return (
    <Box>
      <Text dimColor>{DIVIDER_CHAR.repeat(availableWidth)}</Text>
    </Box>
  )
}

export const MessageDivider = memo(MessageDividerImpl)
MessageDivider.displayName = 'MessageDivider'
