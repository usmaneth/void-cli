/**
 * Renders the streamed body of a ToolCard by subscribing to the
 * PartStream for a given toolUseID.
 *
 * One component per tool-type so each can render its shape — Bash lines
 * (10-line collapse), file meta, diff skeleton, result counter — in
 * the incremental style ported from opencode's session renderer.
 *
 * Falls back to `children` (the old blob rendering) when:
 * - VOID_STREAMING_PARTS is off
 * - no toolUseID was provided
 * - the stream has gone terminal AND we have a final children result
 *   (the old rendering is still higher-fidelity for the completed view)
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { ToolCardType } from '../ToolCard.js'
import type { AggregatedParts } from './aggregator.js'
import { useToolPartStream } from './useToolPartStream.js'
import type { ToolPart } from './toolParts.js'

const BASH_COLLAPSE_MAX = 10

export type StreamingToolBodyProps = {
  type: ToolCardType
  toolUseID: string
  /** Final-state children from the legacy renderer; used as a fallback. */
  fallback: React.ReactNode
  /** Force the streaming render even when a fallback is available.
   *  Useful for tests / snapshots of the in-flight state. */
  forceStreaming?: boolean
}

export function StreamingToolBody({
  type,
  toolUseID,
  fallback,
  forceStreaming = false,
}: StreamingToolBodyProps): React.ReactNode {
  const agg = useToolPartStream(toolUseID)
  return renderStreamingBody({ type, agg, fallback, forceStreaming })
}

/** Pure renderer — split out so snapshot tests can exercise it without
 *  needing a live EventEmitter. */
export function renderStreamingBody(args: {
  type: ToolCardType
  agg: AggregatedParts
  fallback: React.ReactNode
  forceStreaming?: boolean
}): React.ReactNode {
  const { type, agg, fallback, forceStreaming } = args

  // If nothing has streamed yet and we have a final fallback, keep
  // that. This is the resumed-transcript path — we never had a live
  // stream to begin with.
  const hasParts = agg.ordered.length > 0
  const terminal = agg.done || agg.cancelled
  if (!hasParts && !forceStreaming) {
    return fallback
  }

  // Terminal state + a non-null fallback → show the legacy renderer,
  // which already has full-fidelity formatting for the final result.
  // We still want terminal state to mean "stop the spinner" though;
  // renderByType checks agg.done before rendering a spinner row.
  if (terminal && fallback != null && !forceStreaming) {
    return fallback
  }

  return renderByType(type, agg)
}

function renderByType(
  type: ToolCardType,
  agg: AggregatedParts,
): React.ReactNode {
  switch (type) {
    case 'bash':
      return <BashStreamBody agg={agg} />
    case 'read':
      return <ReadStreamBody agg={agg} />
    case 'edit':
    case 'write':
      return <EditStreamBody agg={agg} />
    case 'glob':
    case 'grep':
      return <SearchStreamBody agg={agg} />
    default:
      return <GenericStreamBody agg={agg} />
  }
}

function InterruptedTag({ cancelled }: { cancelled: boolean }): React.ReactNode {
  if (!cancelled) return null
  return (
    <Box>
      <Text color="red">◆ interrupted</Text>
    </Box>
  )
}

// Simple ellipsis-style animated glyph. Deliberately not using the
// heavyweight <Spinner /> component here — we want a one-row indicator
// that doesn't conflict with the global streaming spinner.
const STREAM_GLYPH = '⋯'

function StreamingSpinnerRow({
  agg,
  label,
}: {
  agg: AggregatedParts
  label: string
}): React.ReactNode {
  if (agg.done || agg.cancelled) return null
  return (
    <Box flexDirection="row" gap={1}>
      <Text color="cyan">{STREAM_GLYPH}</Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}

function BashStreamBody({
  agg,
}: {
  agg: AggregatedParts
}): React.ReactNode {
  const lines = agg.ordered.filter(
    (p): p is Extract<ToolPart, { kind: 'bash_line' }> =>
      p.kind === 'bash_line',
  )
  // Respect the 10-line collapse limit: show last N, note truncation.
  const visible = lines.slice(-BASH_COLLAPSE_MAX)
  const hiddenCount = lines.length - visible.length
  return (
    <Box flexDirection="column">
      {hiddenCount > 0 && (
        <Box>
          <Text dimColor>… {hiddenCount} earlier line{hiddenCount === 1 ? '' : 's'} hidden …</Text>
        </Box>
      )}
      {visible.map(line => (
        <Box key={line.id}>
          <Text color={line.stream === 'stderr' ? 'red' : undefined}>
            {line.text}
          </Text>
        </Box>
      ))}
      <StreamingSpinnerRow agg={agg} label="running…" />
      <InterruptedTag cancelled={agg.cancelled} />
    </Box>
  )
}

function ReadStreamBody({
  agg,
}: {
  agg: AggregatedParts
}): React.ReactNode {
  const pathPart = agg.ordered.find(p => p.kind === 'read_path') as
    | Extract<ToolPart, { kind: 'read_path' }>
    | undefined
  const metaPart = agg.ordered.find(p => p.kind === 'read_meta') as
    | Extract<ToolPart, { kind: 'read_meta' }>
    | undefined
  return (
    <Box flexDirection="column">
      {pathPart && (
        <Box>
          <Text>Reading </Text>
          <Text bold>{pathPart.path}</Text>
        </Box>
      )}
      {metaPart && (
        <Box>
          <Text dimColor>
            {typeof metaPart.sizeBytes === 'number'
              ? `${metaPart.sizeBytes} bytes`
              : ''}
            {typeof metaPart.sizeBytes === 'number' &&
            typeof metaPart.lineCount === 'number'
              ? ' · '
              : ''}
            {typeof metaPart.lineCount === 'number'
              ? `${metaPart.lineCount} lines`
              : ''}
          </Text>
        </Box>
      )}
      <StreamingSpinnerRow agg={agg} label="loading…" />
      <InterruptedTag cancelled={agg.cancelled} />
    </Box>
  )
}

function EditStreamBody({
  agg,
}: {
  agg: AggregatedParts
}): React.ReactNode {
  const skel = agg.ordered.find(p => p.kind === 'edit_skeleton') as
    | Extract<ToolPart, { kind: 'edit_skeleton' }>
    | undefined
  const hunks = agg.ordered.filter(
    (p): p is Extract<ToolPart, { kind: 'edit_hunk' }> =>
      p.kind === 'edit_hunk',
  )
  return (
    <Box flexDirection="column">
      {skel && (
        <Box>
          <Text>Editing </Text>
          <Text bold>{skel.path}</Text>
          {typeof skel.hunkCount === 'number' && (
            <Text dimColor>
              {' '}· {skel.hunkCount} hunk{skel.hunkCount === 1 ? '' : 's'}
            </Text>
          )}
        </Box>
      )}
      {hunks.map(h => (
        <Box key={h.id} flexDirection="column">
          {h.beforeSnippet && (
            <Box>
              <Text color="red">- {truncate(h.beforeSnippet, 80)}</Text>
            </Box>
          )}
          {h.afterSnippet && (
            <Box>
              <Text color="green">+ {truncate(h.afterSnippet, 80)}</Text>
            </Box>
          )}
        </Box>
      ))}
      <StreamingSpinnerRow agg={agg} label="computing diff…" />
      <InterruptedTag cancelled={agg.cancelled} />
    </Box>
  )
}

function SearchStreamBody({
  agg,
}: {
  agg: AggregatedParts
}): React.ReactNode {
  const count = agg.ordered.find(p => p.kind === 'search_count') as
    | Extract<ToolPart, { kind: 'search_count' }>
    | undefined
  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          {count ? `${count.total} result${count.total === 1 ? '' : 's'}` : 'searching…'}
        </Text>
      </Box>
      <StreamingSpinnerRow agg={agg} label="searching…" />
      <InterruptedTag cancelled={agg.cancelled} />
    </Box>
  )
}

function GenericStreamBody({
  agg,
}: {
  agg: AggregatedParts
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      {agg.ordered.map(p => (
        <Box key={p.id}>
          <Text dimColor>{renderGenericPart(p)}</Text>
        </Box>
      ))}
      <StreamingSpinnerRow agg={agg} label="working…" />
      <InterruptedTag cancelled={agg.cancelled} />
    </Box>
  )
}

function renderGenericPart(p: ToolPart): string {
  switch (p.kind) {
    case 'text_line':
      return p.text
    case 'bash_line':
      return p.text
    case 'read_path':
      return p.path
    case 'read_meta':
      return `${p.sizeBytes ?? '?'} bytes · ${p.lineCount ?? '?'} lines`
    case 'edit_skeleton':
      return `edit ${p.path}`
    case 'edit_hunk':
      return `hunk ${p.hunkIndex}`
    case 'search_count':
      return `${p.total} results`
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
