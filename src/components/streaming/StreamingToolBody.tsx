/**
 * Renders the streamed body of a ToolCard by subscribing to the
 * PartStream for a given toolUseID, converting the aggregated parts
 * into a `StreamingView` (see streamingView.ts) and then to JSX.
 *
 * The split between streamingView.ts (pure, no React/Ink) and this
 * file (React/Ink) lets snapshot tests exercise the decision logic
 * without booting the terminal renderer.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { ToolCardType } from '../ToolCard.js'
import { useToolPartStream } from './useToolPartStream.js'
import {
  computeStreamingView,
  truncate,
  type StreamingView,
} from './streamingView.js'

// Simple ellipsis-style glyph. We intentionally avoid the heavier
// <Spinner /> component here — ToolCard is nested inside a message,
// and a one-row indicator reads cleanly alongside live content.
const STREAM_GLYPH = '⋯'

export type StreamingToolBodyProps = {
  type: ToolCardType
  toolUseID: string
  fallback: React.ReactNode
  forceStreaming?: boolean
}

export function StreamingToolBody({
  type,
  toolUseID,
  fallback,
  forceStreaming = false,
}: StreamingToolBodyProps): React.ReactNode {
  const agg = useToolPartStream(toolUseID)
  const view = computeStreamingView({
    type,
    agg,
    hasFallback: fallback != null,
    forceStreaming,
  })
  return <ViewRenderer view={view} fallback={fallback} />
}

/** Re-exported for completeness — mostly consumed by tests. */
export { computeStreamingView } from './streamingView.js'

function ViewRenderer({
  view,
  fallback,
}: {
  view: StreamingView
  fallback: React.ReactNode
}): React.ReactNode {
  switch (view.kind) {
    case 'fallback':
      return fallback
    case 'bash':
      return <BashView view={view} />
    case 'read':
      return <ReadView view={view} />
    case 'edit':
      return <EditView view={view} />
    case 'search':
      return <SearchView view={view} />
    case 'generic':
      return <GenericView view={view} />
  }
}

function Spinner({
  show,
  label,
}: {
  show: boolean
  label: string
}): React.ReactNode {
  if (!show) return null
  return (
    <Box flexDirection="row" gap={1}>
      <Text color="cyan">{STREAM_GLYPH}</Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}

function Interrupted({
  show,
}: {
  show: boolean
}): React.ReactNode {
  if (!show) return null
  return (
    <Box>
      <Text color="red">◆ interrupted</Text>
    </Box>
  )
}

function BashView({
  view,
}: {
  view: Extract<StreamingView, { kind: 'bash' }>
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      {view.hiddenCount > 0 && (
        <Box>
          <Text dimColor>
            … {view.hiddenCount} earlier line
            {view.hiddenCount === 1 ? '' : 's'} hidden …
          </Text>
        </Box>
      )}
      {view.visible.map((text, i) => (
        <Box key={`line-${i}`}>
          <Text color={view.streams[i] === 'stderr' ? 'red' : undefined}>
            {text}
          </Text>
        </Box>
      ))}
      <Spinner show={view.showSpinner} label="running…" />
      <Interrupted show={view.interrupted} />
    </Box>
  )
}

function ReadView({
  view,
}: {
  view: Extract<StreamingView, { kind: 'read' }>
}): React.ReactNode {
  const metaText = [
    typeof view.sizeBytes === 'number' ? `${view.sizeBytes} bytes` : '',
    typeof view.lineCount === 'number' ? `${view.lineCount} lines` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Box flexDirection="column">
      {view.path && (
        <Box>
          <Text>Reading </Text>
          <Text bold>{view.path}</Text>
        </Box>
      )}
      {metaText && (
        <Box>
          <Text dimColor>{metaText}</Text>
        </Box>
      )}
      <Spinner show={view.showSpinner} label="loading…" />
      <Interrupted show={view.interrupted} />
    </Box>
  )
}

function EditView({
  view,
}: {
  view: Extract<StreamingView, { kind: 'edit' }>
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      {view.path && (
        <Box>
          <Text>Editing </Text>
          <Text bold>{view.path}</Text>
          {typeof view.hunkCount === 'number' && (
            <Text dimColor>
              {' '}· {view.hunkCount} hunk{view.hunkCount === 1 ? '' : 's'}
            </Text>
          )}
        </Box>
      )}
      {view.hunks.map((h, i) => (
        <Box key={`h-${i}`} flexDirection="column">
          {h.before && (
            <Box>
              <Text color="red">- {truncate(h.before, 80)}</Text>
            </Box>
          )}
          {h.after && (
            <Box>
              <Text color="green">+ {truncate(h.after, 80)}</Text>
            </Box>
          )}
        </Box>
      ))}
      <Spinner show={view.showSpinner} label="computing diff…" />
      <Interrupted show={view.interrupted} />
    </Box>
  )
}

function SearchView({
  view,
}: {
  view: Extract<StreamingView, { kind: 'search' }>
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          {typeof view.count === 'number'
            ? `${view.count} result${view.count === 1 ? '' : 's'}`
            : 'searching…'}
        </Text>
      </Box>
      <Spinner show={view.showSpinner} label="searching…" />
      <Interrupted show={view.interrupted} />
    </Box>
  )
}

function GenericView({
  view,
}: {
  view: Extract<StreamingView, { kind: 'generic' }>
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      {view.lines.map((line, i) => (
        <Box key={`g-${i}`}>
          <Text dimColor>{line}</Text>
        </Box>
      ))}
      <Spinner show={view.showSpinner} label="working…" />
      <Interrupted show={view.interrupted} />
    </Box>
  )
}
