/**
 * Tool-result integration helpers for the LSP aggregator.
 *
 * Tools like Edit / Write / Bash run synchronously and produce a tool_result
 * string that the model sees. LSP diagnostics, however, arrive asynchronously
 * from the language server after a didSave. This module closes that gap by:
 *
 *   - Subscribing to the aggregator's 'lsp.diagnostics.changed' event for
 *     the touched file
 *   - Waiting up to `timeoutMs` for an update, then snapshotting the cache
 *   - Formatting the snapshot with formatDiagnosticsForToolResult() so the
 *     tool can concat it onto its result string
 *
 * If the language isn't LSP-served, or no update arrives in the window, the
 * helper resolves with an empty string — callers can append unconditionally.
 *
 * The feature is gated behind VOID_LSP_SERVER=1, matching the rest of the
 * aggregator. When the flag is off, collectDiagnosticsForToolResult()
 * always resolves with ''.
 */

import {
  formatDiagnosticsForToolResult,
  getDiagnosticsBus,
  getDiagnostics,
  isLspServerEnabled,
  LSP_DIAGNOSTICS_CHANGED,
  uriToPath,
  type DiagnosticChangeEvent,
} from './diagnostics.js'
import { watchFile } from './watcher.js'

const DEFAULT_TIMEOUT_MS = 1200

/**
 * Snapshot diagnostics for a file and return a formatted block suitable for
 * appending to a tool result string. Resolves with '' when the feature flag
 * is off, when no LSP covers the file, or when nothing publishes within the
 * timeout.
 *
 * Why the wait? typescript-language-server typically republishes within
 * 200-800ms after didSave on a touched file; we cap at 1.2s so tools don't
 * block longer than the model latency already being paid. The wait resolves
 * *early* as soon as any change event arrives for this file.
 */
export async function collectDiagnosticsForToolResult(
  filePath: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  if (!isLspServerEnabled()) return ''
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const target = uriToPath(filePath)

  // Start tracking on the watcher so external saves on this file also feed
  // the aggregator going forward.
  try {
    watchFile(target)
  } catch {
    // non-fatal
  }

  // If we already have a fresh snapshot, return immediately.
  const existing = getDiagnostics(target)
  if (existing.length > 0) {
    return formatDiagnosticsForToolResult(target)
  }

  // Otherwise wait for a change event.
  await waitForDiagnosticUpdate(target, timeoutMs)
  return formatDiagnosticsForToolResult(target)
}

/**
 * Resolve when a diagnostic change event arrives for the given path, or when
 * `timeoutMs` elapses. Exposed for tests.
 */
export function waitForDiagnosticUpdate(
  fsPath: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>(resolve => {
    const bus = getDiagnosticsBus()
    let done = false
    const handler = (e: DiagnosticChangeEvent): void => {
      if (done) return
      if (uriToPath(e.path) !== uriToPath(fsPath)) return
      done = true
      bus.off(LSP_DIAGNOSTICS_CHANGED, handler)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      bus.off(LSP_DIAGNOSTICS_CHANGED, handler)
      resolve()
    }, timeoutMs)
    bus.on(LSP_DIAGNOSTICS_CHANGED, handler)
  })
}

/**
 * Append diagnostics (when present) to a tool-result string. Non-destructive:
 * returns the original result when the feature flag is off or the cache is
 * empty. Adds a single blank-line separator so the output stays readable.
 *
 * Use this from mapToolResultToToolResultBlockParam() or similar tool
 * result-formatting functions.
 */
export function appendDiagnosticsToResult(
  result: string,
  filePath: string,
): string {
  if (!isLspServerEnabled()) return result
  const block = formatDiagnosticsForToolResult(filePath)
  if (!block) return result
  return `${result}\n\n${block}`
}
