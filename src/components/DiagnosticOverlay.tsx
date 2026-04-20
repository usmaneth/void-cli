/**
 * <DiagnosticOverlay /> — inline LSP diagnostic display that renders under
 * (or beside) a diff/patch for FileEdit / FileWrite permission prompts and
 * past tool-card message rows.
 *
 * The heavy lifting lives in `src/services/lsp/overlay.ts` — this file is
 * just the Ink presentation layer.
 *
 * Gated behind `VOID_INLINE_DIAGNOSTICS=1`. When the flag is off (or there
 * are no diagnostics for the file), the component renders `null` so host
 * layouts are unaffected.
 */

import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { getDiagnostics, type LspDiagnostic } from '../services/lsp/diagnostics.js'
import {
  buildOverlay,
  computeDelta,
  isInlineDiagnosticsEnabled,
  renderOverlayBadge,
  type DiagnosticDelta,
  type DiagnosticOverlay as Overlay,
} from '../services/lsp/overlay.js'
import { getSnapshot } from '../services/lsp/historySnapshot.js'

type Props = {
  /** File path the diff renders for. */
  filePath: string
  /**
   * Optional explicit diagnostic list. When omitted, pulled from the live
   * aggregator cache. Used by session-history rendering to show a captured
   * snapshot.
   */
  diagnostics?: readonly LspDiagnostic[] | null
  /**
   * Optional snapshot key (tool-use-id). When provided, we look the snapshot
   * up in the history store and use *those* diagnostics. Falls back to the
   * live cache when the snapshot is missing.
   */
  snapshotKey?: string
  /**
   * Pre-edit diagnostic list — when provided, the overlay also renders a
   * "[+1E -2W]" delta summary. Used by permission prompts to preview the
   * post-apply diagnostics.
   */
  before?: readonly LspDiagnostic[] | null
  /** Override terminal width (for snapshot tests). */
  width?: number
}

const SEVERITY_COLOR: Record<LspDiagnostic['severity'], string> = {
  Error: 'red',
  Warning: 'yellow',
  Info: 'blue',
  Hint: 'gray',
}

/**
 * Renders a compact overlay block:
 *
 *   [2E 1W]
 *   L12  ✗ error: Type 'string' is not assignable to type 'number'.
 *   L88  ⚠ warning: 'foo' is declared but never used.
 *
 * Narrow terminals collapse to badges only. Returns null when disabled.
 */
export function DiagnosticOverlay(props: Props): React.ReactNode {
  if (!isInlineDiagnosticsEnabled()) return null

  const { columns } = useTerminalSize()
  const width = props.width ?? columns

  // Resolve diagnostic source: explicit > snapshot > live cache.
  const diagnostics = resolveDiagnostics(props)
  const overlay = buildOverlay(diagnostics, { enabled: true, columns: width })

  if (overlay.ordered.length === 0 && !props.before) return null

  // Optional delta (only when caller passed a "before" list).
  let delta: DiagnosticDelta | null = null
  if (props.before) {
    const beforeOv = buildOverlay(props.before, { enabled: true, columns: width })
    delta = computeDelta(beforeOv, overlay)
  }

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <OverlayHeader overlay={overlay} delta={delta} />
      {!overlay.narrow &&
        overlay.ordered.map(o => (
          <Box key={o.line} flexDirection="row">
            <Text dimColor>L{o.line}</Text>
            <Text>{'  '}</Text>
            <Text color={SEVERITY_COLOR[o.severity]}>{o.prefix}</Text>
            <Text>{o.message}</Text>
            {o.extraCount > 0 && (
              <Text dimColor>{` (+${o.extraCount} more)`}</Text>
            )}
          </Box>
        ))}
      {overlay.narrow &&
        overlay.ordered.map(o => (
          <Box key={o.line} flexDirection="row">
            <Text dimColor>L{o.line}</Text>
            <Text>{' '}</Text>
            <Text color={SEVERITY_COLOR[o.severity]}>{o.badge}</Text>
          </Box>
        ))}
    </Box>
  )
}

/**
 * A "not recorded" placeholder — for past FileEdit tool cards where no
 * snapshot was captured (feature flag was off at execute time). Renders a
 * single dim line so the UI stays consistent.
 */
export function DiagnosticsNotRecorded(): React.ReactNode {
  if (!isInlineDiagnosticsEnabled()) return null
  return (
    <Box paddingLeft={1}>
      <Text dimColor>diagnostics not recorded</Text>
    </Box>
  )
}

function OverlayHeader({
  overlay,
  delta,
}: {
  overlay: Overlay
  delta: DiagnosticDelta | null
}): React.ReactNode {
  const badge = renderOverlayBadge(overlay)
  if (!badge && !delta?.summary) return null
  return (
    <Box flexDirection="row">
      {badge && <Text dimColor>{badge}</Text>}
      {delta?.summary && (
        <>
          <Text>{'  '}</Text>
          <Text color={delta.newErrors > 0 ? 'red' : 'yellow'}>
            {delta.summary}
          </Text>
        </>
      )}
    </Box>
  )
}

function resolveDiagnostics(props: Props): readonly LspDiagnostic[] {
  if (props.diagnostics) return props.diagnostics
  if (props.snapshotKey) {
    const snap = getSnapshot(props.snapshotKey)
    if (snap) return snap.diagnostics
  }
  return getDiagnostics(props.filePath)
}
