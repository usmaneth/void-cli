import * as React from 'react'
import { memo } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'
import { type ThemeName } from '../utils/theme.js'

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
  bash: () => 'rgb(59, 130, 246)', // Blue-500
  edit: () => 'rgb(16, 185, 129)', // Emerald-500
  write: () => 'rgb(34, 197, 94)', // Green-500
  read: () => 'rgb(234, 179, 8)', // Yellow-500
  glob: () => 'rgb(168, 85, 247)', // Purple-500
  grep: () => 'rgb(217, 70, 239)', // Fuchsia-500
  agent: () => 'rgb(6, 182, 212)', // Cyan-500
  web: () => 'rgb(249, 115, 22)', // Orange-500
  mcp: () => 'rgb(100, 116, 139)', // Slate-500
  default: () => 'rgb(100, 116, 139)', // Slate-500
}

const TOOL_CARD_ICONS: Record<ToolCardType, string> = {
  bash: '❯_',
  edit: '✎',
  write: '✚',
  read: '◈',
  glob: '⬡',
  grep: '⌕',
  agent: '◆',
  web: '◉',
  mcp: '▣',
  default: '●',
}

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
  type: ToolCardType
  label: string
  status?: string
  children: React.ReactNode
  collapsed?: boolean
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

  if (collapsed) {
    return (
      <Box paddingLeft={1} flexDirection="row" gap={1}>
        <Text color={accentColor} bold>
          {icon} {label}
        </Text>
        {status && (
          <>
            <Text dimColor>·</Text>
            <Text dimColor>{status}</Text>
          </>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={1} width="100%">
      <Box flexDirection="row" backgroundColor="bashMessageBackgroundColor" borderStyle="round" borderColor={accentColor} paddingX={1}>
        <Box flexGrow={1} flexDirection="row" gap={1}>
          <Text color={accentColor} bold>{icon}</Text>
          <Text bold color="inverseText">{label}</Text>
        </Box>
        {status && (
          <Box>
            <Text dimColor>{status}</Text>
          </Box>
        )}
      </Box>
      <Box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        borderStyle="single"
        borderTop={false}
        borderRight={false}
        borderBottom={false}
        borderColor={accentColor}
        marginLeft={1}
        {...(maxLines > 0 ? { height: maxLines } : {})}
      >
        {children}
      </Box>
    </Box>
  )
}

export const ToolCard = memo(ToolCardImpl)
