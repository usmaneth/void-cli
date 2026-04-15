import * as React from 'react'
import { memo } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'

// ── Gutter colors by message type ──────────────────────────────────────────

const GUTTER_COLORS: Record<string, string> = {
  assistant: 'claude',
  user: 'success',
  system: 'warning',
  tool: 'suggestion',
  error: 'error',
}

const GUTTER_ICONS: Record<string, string> = {
  assistant: '┃',
  user: '┃',
  system: '┊',
  tool: '┃',
  error: '┃',
}

export function getGutterColor(type: string): string {
  return GUTTER_COLORS[type] ?? 'inactive'
}

// ── MessageGutter ──────────────────────────────────────────────────────────

type GutterType = 'assistant' | 'user' | 'system' | 'tool' | 'error'

type MessageGutterProps = {
  type: GutterType
  children: React.ReactNode
}

function MessageGutterImpl({ type, children }: MessageGutterProps) {
  const color = getGutterColor(type)
  const dimmed = type === 'system'
  const gutterChar = GUTTER_ICONS[type] ?? '┃'

  return (
    <Box flexDirection="row">
      <Text color={color} dimColor={dimmed}>
        {gutterChar}
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
const DIVIDER_DOT = '·'

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
        <Text dimColor>{left}</Text>
        <Text color="claude">{labelWithPadding}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    )
  }

  // Use a dotted pattern for unlabeled dividers — more refined look
  const pattern = (DIVIDER_CHAR + DIVIDER_CHAR + DIVIDER_DOT).repeat(Math.ceil(availableWidth / 3)).slice(0, availableWidth)
  return (
    <Box>
      <Text dimColor>{pattern}</Text>
    </Box>
  )
}

export const MessageDivider = memo(MessageDividerImpl)
MessageDivider.displayName = 'MessageDivider'
