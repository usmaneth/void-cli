/**
 * LspStatus — a compact SessionHUD segment showing the current
 * LSP diagnostic roll-up across the workspace.
 *
 * Render format:  "lsp: 3E 7W"
 *   - "3E" in red when errors > 0
 *   - "7W" in yellow when warnings > 0
 *   - Entire segment hidden when the feature flag (VOID_LSP_SERVER) is off
 *     or when counts are zero (keeps the HUD clean on a healthy workspace)
 *
 * Subscribes to the aggregator's 'lsp.diagnostics.changed' event so the
 * counts update live as the language server re-publishes after edits.
 */

import * as React from 'react'
import { useEffect, useState } from 'react'
import {
  getCounts,
  getDiagnosticsBus,
  isLspServerEnabled,
  LSP_DIAGNOSTICS_CHANGED,
  type DiagnosticCounts,
} from '../services/lsp/diagnostics.js'
import { Text } from '../ink.js'
import { getPalette } from '../theme/index.js'

export function LspStatus(): React.ReactNode {
  if (!isLspServerEnabled()) return null

  const palette = getPalette()
  const [counts, setCounts] = useState<DiagnosticCounts>(() => getCounts())

  useEffect(() => {
    const bus = getDiagnosticsBus()
    const handler = (): void => {
      setCounts(getCounts())
    }
    bus.on(LSP_DIAGNOSTICS_CHANGED, handler)
    return () => {
      bus.off(LSP_DIAGNOSTICS_CHANGED, handler)
    }
  }, [])

  if (counts.errors === 0 && counts.warnings === 0) return null

  return (
    <>
      <Text dimColor>{' · lsp:'}</Text>
      {counts.errors > 0 && (
        <Text color={palette.state.failure}>{' ' + counts.errors + 'E'}</Text>
      )}
      {counts.warnings > 0 && (
        <Text color={palette.state.warning}>{' ' + counts.warnings + 'W'}</Text>
      )}
    </>
  )
}
