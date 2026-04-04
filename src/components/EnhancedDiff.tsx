/**
 * EnhancedDiff — improved diff rendering with syntax-aware coloring.
 *
 * Renders a unified diff string with color-coded additions, deletions,
 * hunk headers, and line numbers. Supports collapsed mode and truncation.
 */
import * as React from 'react'
import { memo, useMemo } from 'react'
import { Box, Text, useTheme } from '../ink.js'

type EnhancedDiffProps = {
  /** Unified diff string to render */
  diff: string
  /** Optional file name to display as a header */
  fileName?: string
  /** Maximum number of diff lines to show before truncating */
  maxLines?: number
  /** Show a compact summary instead of the full diff */
  collapsed?: boolean
}

type DiffLine = {
  type: 'addition' | 'deletion' | 'context' | 'hunk' | 'file-header' | 'other'
  content: string
  lineNumber: number
}

/**
 * Parse a unified diff string and return stats about it.
 */
export function parseDiffStats(diff: string): {
  additions: number
  deletions: number
  files: string[]
} {
  const lines = diff.split('\n')
  let additions = 0
  let deletions = 0
  const files: string[] = []

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++
    } else if (line.startsWith('+++ ') || line.startsWith('diff --git')) {
      // Extract file name from +++ b/path or diff --git a/path b/path
      const plusMatch = line.match(/^\+\+\+ [ab]\/(.+)$/)
      const gitMatch = line.match(/^diff --git a\/.+ b\/(.+)$/)
      const name = plusMatch?.[1] ?? gitMatch?.[1]
      if (name && !files.includes(name)) {
        files.push(name)
      }
    }
  }

  return { additions, deletions, files }
}

function classifyLine(line: string): DiffLine['type'] {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('---') || line.startsWith('+++')) return 'file-header'
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  if (line.startsWith(' ')) return 'context'
  return 'other'
}

function parseDiffLines(diff: string): DiffLine[] {
  return diff.split('\n').map((content, index) => ({
    type: classifyLine(content),
    content,
    lineNumber: index + 1,
  }))
}

function EnhancedDiffImpl({
  diff,
  fileName,
  maxLines,
  collapsed = false,
}: EnhancedDiffProps): React.ReactNode {
  const [_theme] = useTheme()

  const lines = useMemo(() => parseDiffLines(diff), [diff])
  const stats = useMemo(() => parseDiffStats(diff), [diff])

  // Collapsed mode: show a one-line summary
  if (collapsed) {
    return (
      <Box>
        {fileName && (
          <>
            <Text bold>{fileName}</Text>
            <Text dimColor> — </Text>
          </>
        )}
        <Text color="green">+{stats.additions}</Text>
        <Text dimColor>/</Text>
        <Text color="red">-{stats.deletions}</Text>
        <Text dimColor> lines</Text>
      </Box>
    )
  }

  // Determine which lines to display
  const truncated = maxLines != null && lines.length > maxLines
  const visibleLines = truncated ? lines.slice(0, maxLines) : lines
  const remainingCount = truncated ? lines.length - maxLines! : 0

  // Width of the line-number gutter
  const gutterWidth = Math.max(
    String(visibleLines.length > 0 ? visibleLines[visibleLines.length - 1]!.lineNumber : 1)
      .length,
    3,
  )

  return (
    <Box flexDirection="column">
      {/* File name header */}
      {fileName && (
        <Box marginBottom={1}>
          <Text bold>{'─── '}{fileName}{' '}</Text>
          <Text dimColor>
            (<Text color="green">+{stats.additions}</Text>
            {' / '}
            <Text color="red">-{stats.deletions}</Text>)
          </Text>
        </Box>
      )}

      {/* Diff lines */}
      {visibleLines.map((line) => (
        <Box key={line.lineNumber} flexDirection="row">
          {/* Gutter: line number */}
          <Text dimColor>
            {String(line.lineNumber).padStart(gutterWidth, ' ')}{' │ '}
          </Text>

          {/* Line content */}
          {line.type === 'addition' && (
            <Text color="green">{line.content}</Text>
          )}
          {line.type === 'deletion' && (
            <Text color="red">{line.content}</Text>
          )}
          {line.type === 'hunk' && (
            <Text color="cyan" dimColor>{line.content}</Text>
          )}
          {line.type === 'file-header' && (
            <Text bold>{line.content}</Text>
          )}
          {line.type === 'context' && (
            <Text dimColor>{line.content}</Text>
          )}
          {line.type === 'other' && (
            <Text dimColor>{line.content}</Text>
          )}
        </Box>
      ))}

      {/* Truncation indicator */}
      {truncated && (
        <Box paddingLeft={gutterWidth + 3}>
          <Text dimColor>{'... '}{remainingCount}{' more lines'}</Text>
        </Box>
      )}
    </Box>
  )
}

export const EnhancedDiff = memo(EnhancedDiffImpl)
