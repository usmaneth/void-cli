import * as React from 'react'
import { memo } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'
import { type ThemeName } from '../utils/theme.js'
import { StreamingToolBody } from './streaming/StreamingToolBody.js'
import { isStreamingEnabled } from './streaming/toolParts.js'

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

/**
 * Visual state of the tool card. `neutral` is the default (no colored
 * accent beyond the per-tool tint). The other variants override the
 * accent to communicate the outcome of a tool run:
 *   - success  → theme green
 *   - error    → theme red
 *   - warn     → theme yellow (partial/degraded results)
 *   - rejected → theme red, paired with a banner body
 *   - canceled → theme gray, paired with a banner body
 *   - running  → theme yellow, dim pulse (visual cue only)
 *
 * Per-tool UI can opt in by passing `variant`. Tools that don't set it
 * render with the legacy per-tool color palette, unchanged.
 */
export type ToolCardVariant =
  | 'neutral'
  | 'success'
  | 'error'
  | 'warn'
  | 'rejected'
  | 'canceled'
  | 'running'

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

/**
 * Theme-token colors used when a caller specifies a ToolCardVariant.
 * Tokens resolve through the terminal theme so themes can retune them.
 */
const VARIANT_ACCENT: Record<ToolCardVariant, string | undefined> = {
  neutral: undefined,
  success: 'success',
  error: 'error',
  warn: 'warning',
  rejected: 'error',
  canceled: 'subtle',
  running: 'warning',
}

const VARIANT_GLYPH: Record<ToolCardVariant, string | undefined> = {
  neutral: undefined,
  success: '✓',
  error: '✗',
  warn: '!',
  rejected: '⊘',
  canceled: '⊘',
  running: '⋯',
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
  /**
   * Free-form right-side status string. Kept for backward compatibility
   * with existing tool UIs. Prefer `variant` + `tag` for structured status.
   */
  status?: string
  /**
   * Structured outcome variant. When set, prepends a variant glyph to the
   * header and overrides the accent color to communicate result state.
   */
  variant?: ToolCardVariant
  /**
   * Secondary header line — e.g. a file path, query, or one-line
   * description under the tool label. Kept to a single line with
   * truncate-end wrap so it never pushes the card into more rows.
   */
  subtitle?: string
  /**
   * Right-side chip — e.g. a short result summary ("12 matches"),
   * task id, or model name. Rendered dim.
   */
  tag?: string
  children: React.ReactNode
  collapsed?: boolean
  maxLines?: number
  /** When provided and VOID_STREAMING_PARTS=1, the body subscribes to
   *  the PartStream for this id and renders parts as they arrive. The
   *  `children` node serves as the fallback for the final state. */
  toolUseID?: string
}

function ToolCardImpl({
  type,
  label,
  status,
  variant = 'neutral',
  subtitle,
  tag,
  children,
  collapsed = false,
  maxLines = 0,
  toolUseID,
}: ToolCardProps): React.ReactNode {
  useTerminalSize() // kept for downstream hook ordering / future responsive tweaks
  const [theme] = useTheme()
  const baseAccent = TOOL_CARD_COLORS[type](theme)
  const variantAccent = VARIANT_ACCENT[variant]
  // Variant colors take precedence over the per-tool base color — this is
  // what makes an errored Bash card red instead of blue.
  const accentColor = variantAccent ?? baseAccent
  const icon = TOOL_CARD_ICONS[type]
  const variantGlyph = VARIANT_GLYPH[variant]

  if (collapsed) {
    return (
      <Box paddingLeft={1} flexDirection="row" gap={1}>
        <Text color={accentColor} bold>
          {icon} {label}
        </Text>
        {variantGlyph && (
          <Text color={accentColor} bold>
            {variantGlyph}
          </Text>
        )}
        {tag && (
          <>
            <Text dimColor>·</Text>
            <Text dimColor>{tag}</Text>
          </>
        )}
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
      <Box
        flexDirection="row"
        backgroundColor="bashMessageBackgroundColor"
        borderStyle="round"
        borderColor={accentColor}
        paddingX={1}
      >
        <Box flexGrow={1} flexDirection="row" gap={1}>
          <Text color={accentColor} bold>
            {icon}
          </Text>
          <Text bold color="inverseText">
            {label}
          </Text>
          {variantGlyph && (
            <Text color={accentColor} bold>
              {variantGlyph}
            </Text>
          )}
          {subtitle && (
            <Text dimColor wrap="truncate-end">
              · {subtitle}
            </Text>
          )}
        </Box>
        {tag && (
          <Box marginRight={status ? 1 : 0}>
            <Text dimColor>{tag}</Text>
          </Box>
        )}
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
        {toolUseID && isStreamingEnabled() ? (
          <StreamingToolBody
            type={type}
            toolUseID={toolUseID}
            fallback={children}
          />
        ) : (
          children
        )}
      </Box>
    </Box>
  )
}

export const ToolCard = memo(ToolCardImpl)
