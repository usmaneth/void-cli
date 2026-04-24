/**
 * ResultSummary — shared primitive for the "list of items" body shape
 * used across Grep, Glob, WebSearch, and other match-oriented tools.
 *
 * Replaces the 5+ bespoke SearchResultSummary-style components flagged
 * in the audit (GrepTool's SearchResultSummary, WebSearchTool's
 * summary, etc.) with one consistent renderer.
 *
 * Renders:
 *   • a "X items" count line at the top
 *   • the first N items (default 5)
 *   • a "… and M more" tail when truncated
 *
 * Tools can opt out of any of these via props.
 */
import * as React from 'react'
import { Box, Text } from '../../ink.js'

type Item = {
  /** Primary text, single line. */
  label: string
  /** Optional dim detail rendered after the label. */
  detail?: string
}

type Props = {
  items: readonly Item[]
  /** Max items to render inline; the rest become "… and N more". */
  max?: number
  /**
   * Optional count label. Default: `${items.length} items` or
   * `${items.length} item` when there's exactly one.
   */
  countLabel?: string
  /** Text shown when the list is empty. */
  emptyText?: string
}

export function ResultSummary({
  items,
  max = 5,
  countLabel,
  emptyText = '(no results)',
}: Props): React.ReactNode {
  if (items.length === 0) {
    return <Text dimColor>{emptyText}</Text>
  }
  const shown = items.slice(0, max)
  const remaining = items.length - shown.length
  const label =
    countLabel ??
    `${items.length} ${items.length === 1 ? 'item' : 'items'}`
  return (
    <Box flexDirection="column">
      <Text dimColor>{label}</Text>
      {shown.map((item, i) => (
        <Box key={i} flexDirection="row">
          <Text wrap="truncate-end">{item.label}</Text>
          {item.detail && (
            <Text dimColor wrap="truncate-end">
              {'  '}
              {item.detail}
            </Text>
          )}
        </Box>
      ))}
      {remaining > 0 && (
        <Text dimColor>… and {remaining} more</Text>
      )}
    </Box>
  )
}
