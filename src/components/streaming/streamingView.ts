/**
 * Pure "what do we show?" logic for the streaming ToolCard body.
 *
 * Kept free of React/Ink imports so snapshot tests can run under plain
 * `node --test` without pulling in the terminal renderer module graph.
 *
 * `computeStreamingView` answers a single question: given the current
 * AggregatedParts + fallback, what should the ToolCard's body render?
 * The answer is a plain tagged-union view model that the JSX layer
 * converts to Box/Text.
 */

import type { AggregatedParts } from './aggregator.js'
import type { ToolPart } from './toolParts.js'
import type { ToolCardType } from '../ToolCard.js'

const BASH_COLLAPSE_MAX = 10

export type StreamingView =
  | { kind: 'fallback' }
  | { kind: 'bash'; visible: string[]; hiddenCount: number; streams: Array<'stdout' | 'stderr'>; showSpinner: boolean; interrupted: boolean }
  | { kind: 'read'; path?: string; sizeBytes?: number; lineCount?: number; showSpinner: boolean; interrupted: boolean }
  | { kind: 'edit'; path?: string; hunkCount?: number; hunks: Array<{ before?: string; after?: string }>; showSpinner: boolean; interrupted: boolean }
  | { kind: 'search'; count?: number; showSpinner: boolean; interrupted: boolean }
  | { kind: 'generic'; lines: string[]; showSpinner: boolean; interrupted: boolean }

export function computeStreamingView(args: {
  type: ToolCardType
  agg: AggregatedParts
  hasFallback: boolean
  forceStreaming?: boolean
}): StreamingView {
  const { type, agg, hasFallback, forceStreaming } = args
  const hasParts = agg.ordered.length > 0
  const terminal = agg.done || agg.cancelled
  // No parts + not forced → fallback (legacy renderer)
  if (!hasParts && !forceStreaming) return { kind: 'fallback' }
  // Terminal + fallback available → legacy renderer wins
  if (terminal && hasFallback && !forceStreaming) return { kind: 'fallback' }

  const showSpinner = !(agg.done || agg.cancelled)
  const interrupted = agg.cancelled

  switch (type) {
    case 'bash':
      return computeBash(agg, showSpinner, interrupted)
    case 'read':
      return computeRead(agg, showSpinner, interrupted)
    case 'edit':
    case 'write':
      return computeEdit(agg, showSpinner, interrupted)
    case 'glob':
    case 'grep':
      return computeSearch(agg, showSpinner, interrupted)
    default:
      return computeGeneric(agg, showSpinner, interrupted)
  }
}

function computeBash(
  agg: AggregatedParts,
  showSpinner: boolean,
  interrupted: boolean,
): Extract<StreamingView, { kind: 'bash' }> {
  const lines = agg.ordered.filter(
    (p): p is Extract<ToolPart, { kind: 'bash_line' }> =>
      p.kind === 'bash_line',
  )
  const visible = lines.slice(-BASH_COLLAPSE_MAX)
  const hiddenCount = lines.length - visible.length
  return {
    kind: 'bash',
    visible: visible.map(p => p.text),
    streams: visible.map(p => p.stream),
    hiddenCount,
    showSpinner,
    interrupted,
  }
}

function computeRead(
  agg: AggregatedParts,
  showSpinner: boolean,
  interrupted: boolean,
): Extract<StreamingView, { kind: 'read' }> {
  const pathPart = agg.ordered.find(p => p.kind === 'read_path') as
    | Extract<ToolPart, { kind: 'read_path' }>
    | undefined
  const metaPart = agg.ordered.find(p => p.kind === 'read_meta') as
    | Extract<ToolPart, { kind: 'read_meta' }>
    | undefined
  return {
    kind: 'read',
    path: pathPart?.path,
    sizeBytes: metaPart?.sizeBytes,
    lineCount: metaPart?.lineCount,
    showSpinner,
    interrupted,
  }
}

function computeEdit(
  agg: AggregatedParts,
  showSpinner: boolean,
  interrupted: boolean,
): Extract<StreamingView, { kind: 'edit' }> {
  const skel = agg.ordered.find(p => p.kind === 'edit_skeleton') as
    | Extract<ToolPart, { kind: 'edit_skeleton' }>
    | undefined
  const hunks = agg.ordered
    .filter(
      (p): p is Extract<ToolPart, { kind: 'edit_hunk' }> =>
        p.kind === 'edit_hunk',
    )
    .map(h => ({ before: h.beforeSnippet, after: h.afterSnippet }))
  return {
    kind: 'edit',
    path: skel?.path,
    hunkCount: skel?.hunkCount,
    hunks,
    showSpinner,
    interrupted,
  }
}

function computeSearch(
  agg: AggregatedParts,
  showSpinner: boolean,
  interrupted: boolean,
): Extract<StreamingView, { kind: 'search' }> {
  const count = agg.ordered.find(p => p.kind === 'search_count') as
    | Extract<ToolPart, { kind: 'search_count' }>
    | undefined
  return {
    kind: 'search',
    count: count?.total,
    showSpinner,
    interrupted,
  }
}

function computeGeneric(
  agg: AggregatedParts,
  showSpinner: boolean,
  interrupted: boolean,
): Extract<StreamingView, { kind: 'generic' }> {
  return {
    kind: 'generic',
    lines: agg.ordered.map(renderGenericLine),
    showSpinner,
    interrupted,
  }
}

function renderGenericLine(p: ToolPart): string {
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

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
