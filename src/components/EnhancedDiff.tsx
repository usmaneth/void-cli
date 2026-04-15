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
  diff: string
  fileName?: string
  maxLines?: number
  collapsed?: boolean
}

type DiffLine = {
  type: 'addition' | 'deletion' | 'context' | 'hunk' | 'file-header' | 'other'
  content: string
  lineNumber: number
}

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
  const [theme] = useTheme()

  const lines = useMemo(() => parseDiffLines(diff), [diff])
  const stats = useMemo(() => parseDiffStats(diff), [diff])

  if (collapsed) {
    return (
      <Box paddingX={1}>
        {fileName && (
          <>
            <Text bold color="subtle">{fileName}</Text>
            <Text dimColor> · </Text>
          </>
        )}
        <Text color="success">+{stats.additions}</Text>
        <Text dimColor> / </Text>
        <Text color="error">-{stats.deletions}</Text>
      </Box>
    )
  }

  const truncated = maxLines != null && lines.length > maxLines
  const visibleLines = truncated ? lines.slice(0, maxLines) : lines
  const remainingCount = truncated ? lines.length - maxLines! : 0

  const gutterWidth = Math.max(
    String(visibleLines.length > 0 ? visibleLines[visibleLines.length - 1]!.lineNumber : 1).length,
    3,
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
      {fileName && (
        <Box marginBottom={1} borderBottom={false} borderStyle="single" borderColor="promptBorder" paddingBottom={0}>
          <Text bold color="ide">📝 {fileName}</Text>
          <Text dimColor>  ·  </Text>
          <Text color="success" bold>+{stats.additions}</Text>
          <Text dimColor> / </Text>
          <Text color="error" bold>-{stats.deletions}</Text>
        </Box>
      )}

      {visibleLines.map((line) => {
        let bgColor = undefined
        let textColor = undefined

        if (line.type === 'addition') {
          bgColor = 'diffAddedDimmed'
          textColor = 'success'
        } else if (line.type === 'deletion') {
          bgColor = 'diffRemovedDimmed'
          textColor = 'error'
        } else if (line.type === 'hunk') {
          bgColor = 'messageActionsBackground'
          textColor = 'suggestion'
        }

        return (
          <Box key={line.lineNumber} flexDirection="row" backgroundColor={bgColor}>
            <Box width={gutterWidth + 2} alignItems="flex-end" paddingRight={1}>
              <Text dimColor color={line.type === 'addition' ? 'success' : line.type === 'deletion' ? 'error' : undefined}>
                {String(line.lineNumber)}
              </Text>
            </Box>
            
            <Text dimColor={line.type === 'context' || line.type === 'other'} color={textColor} bold={line.type === 'file-header'}>
              {line.content}
            </Text>
          </Box>
        )
      })}

      {truncated && (
        <Box paddingLeft={gutterWidth + 2} marginTop={1}>
          <Text dimColor italic>... {remainingCount} more lines</Text>
        </Box>
      )}
    </Box>
  )
}

export const EnhancedDiff = memo(EnhancedDiffImpl)
