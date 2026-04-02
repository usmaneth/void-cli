/**
 * ToolCard — bordered card wrapper for tool invocations and results.
 *
 * Renders a box with a colored left border and tool-type header.
 * Each tool type gets a distinct accent color for quick visual scanning.
 *
 * ┌─ Bash ─────────────────────────────┐
 * │ $ npm test                          │
 * │ ...output...                        │
 * │                            ✓ 1.8s   │
 * └────────────────────────────────────┘
 */
import * as React from 'react'
import { memo, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'
import { getTheme, type ThemeName } from '../utils/theme.js'

export type ToolCardType =
  | 'bash'
  | 'edit'
  | 'write'
  | 'read'
  | 'glob'
  | 'grep'
  | 'agent'
  | 'web'
  | 'mcp'
  | 'default'

const TOOL_CARD_COLORS: Record<ToolCardType, (theme: ThemeName) => string> = {
  bash: () => 'rgb(130, 170, 255)', // Blue
  edit: () => 'rgb(120, 200, 120)', // Green
  write: () => 'rgb(120, 200, 120)', // Green (same as edit)
  read: () => 'rgb(230, 190, 80)', // Yellow
  glob: () => 'rgb(200, 150, 230)', // Purple
  grep: () => 'rgb(200, 150, 230)', // Purple (same as glob)
  agent: () => 'rgb(100, 200, 200)', // Cyan
  web: () => 'rgb(230, 140, 100)', // Orange
  mcp: () => 'rgb(180, 180, 180)', // Gray
  default: () => 'rgb(180, 180, 180)', // Gray
}

const TOOL_CARD_ICONS: Record<ToolCardType, string> = {
  bash: '$',
  edit: '±',
  write: '+',
  read: '◇',
  glob: '⊞',
  grep: '⊘',
  agent: '◈',
  web: '◎',
  mcp: '◆',
  default: '●',
}

/**
 * Resolves a tool name from the tool system to a ToolCardType.
 */
export function resolveToolCardType(toolName: string): ToolCardType {
  const lower = toolName.toLowerCase()
  if (lower.includes('bash') || lower.includes('shell')) return 'bash'
  if (lower.includes('edit') || lower.includes('notebook_edit')) return 'edit'
  if (lower.includes('write')) return 'write'
  if (lower.includes('read') || lower.includes('file_read')) return 'read'
  if (lower.includes('glob') || lower.includes('list_files')) return 'glob'
  if (lower.includes('grep') || lower.includes('search')) return 'grep'
  if (lower.includes('agent')) return 'agent'
  if (lower.includes('web') || lower.includes('fetch')) return 'web'
  if (lower.startsWith('mcp_')) return 'mcp'
  return 'default'
}

type ToolCardProps = {
  /** The tool type for coloring */
  type: ToolCardType
  /** Header label (e.g. "Bash", "Edit · src/foo.ts") */
  label: string
  /** Optional right-aligned status (e.g. "✓ 1.8s", "+2 / -1 lines") */
  status?: string
  /** The card content (tool output) */
  children: React.ReactNode
  /** Whether to show collapsed (single line) or expanded */
  collapsed?: boolean
  /** Max height in lines before truncation (0 = no limit) */
  maxLines?: number
}

function ToolCardImpl({
  type,
  label,
  status,
  children,
  collapsed = false,
  maxLines = 0,
}: ToolCardProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const [theme] = useTheme()
  const accentColor = TOOL_CARD_COLORS[type](theme)
  const icon = TOOL_CARD_ICONS[type]
  const width = Math.min(columns - 4, 120) // Leave margin

  if (collapsed) {
    return (
      <Box paddingLeft={1}>
        <Text color={accentColor}>│</Text>
        <Text> </Text>
        <Text color={accentColor} bold>
          {icon} {label}
        </Text>
        {status && (
          <>
            <Text dimColor> — </Text>
            <Text dimColor>{status}</Text>
          </>
        )}
      </Box>
    )
  }

  // Build the top border: ┌─ Label ─────────┐
  const headerText = ` ${icon} ${label} `
  const topBorderLen = Math.max(0, width - headerText.length - 2)
  const topBorder = `┌─${headerText}${'─'.repeat(topBorderLen)}┐`

  // Bottom border with optional status
  let bottomBorder: string
  if (status) {
    const statusText = ` ${status} `
    const bottomLeft = Math.max(0, width - statusText.length - 2)
    bottomBorder = `└${'─'.repeat(bottomLeft)}${statusText}─┘`
  } else {
    bottomBorder = `└${'─'.repeat(Math.max(0, width))}┘`
  }

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color={accentColor}>{topBorder}</Text>
      <Box
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        {...(maxLines > 0 ? { height: maxLines } : {})}
      >
        <Box flexDirection="row">
          <Text color={accentColor}>│ </Text>
          <Box flexDirection="column" flexGrow={1}>
            {children}
          </Box>
        </Box>
      </Box>
      <Text color={accentColor}>{bottomBorder}</Text>
    </Box>
  )
}

export const ToolCard = memo(ToolCardImpl)
