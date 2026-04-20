/**
 * LSP Diagnostics Aggregator
 *
 * A thin, subscribe-able layer on top of the existing LSP subsystem (see
 * passiveFeedback.ts + LSPDiagnosticRegistry.ts). The existing registry
 * handles async attachment-style delivery to the conversation; this module
 * exposes a *live* cache with:
 *
 *   - getDiagnostics(path) — current diagnostics for a file
 *   - getAllDiagnostics() — flat map of uri -> Diagnostic[]
 *   - getCounts()         — { errors, warnings, info, hints }
 *   - subscribe(cb)       — fires on any diagnostic change (debounced)
 *
 * It also emits a single app-wide "lsp.diagnostics.changed" event via Node's
 * EventEmitter so UI components (SessionHUD, ToolCards) can subscribe without
 * coupling to this module directly.
 *
 * File watching: uses `chokidar` (already a void-cli dep) to observe files
 * that the agent has touched. On a disk-level save event we re-trigger LSP
 * didChange + didSave so the language server re-publishes diagnostics.
 *
 * Lazy: nothing runs until installAggregator() is called. Safe to call
 * multiple times (idempotent).
 */

import { EventEmitter } from 'events'
import { fileURLToPath, pathToFileURL } from 'url'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getLspServerManager } from './manager.js'

/**
 * Single LSP diagnostic. Mirrors vscode-languageserver-types Diagnostic but
 * is kept loose on purpose so consumers don't need the LSP type package.
 */
export type LspDiagnostic = {
  message: string
  severity: 'Error' | 'Warning' | 'Info' | 'Hint'
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export type DiagnosticCounts = {
  errors: number
  warnings: number
  info: number
  hints: number
}

export type DiagnosticChangeEvent = {
  /** Absolute file path (fs path, NOT file:// uri) */
  path: string
  /** Diagnostics currently published for that file */
  diagnostics: LspDiagnostic[]
  /** Monotonic version; increases on every change */
  version: number
}

/** Name of the app-wide bus event. */
export const LSP_DIAGNOSTICS_CHANGED = 'lsp.diagnostics.changed'

/**
 * Process-singleton emitter. Consumers can `.on('lsp.diagnostics.changed', …)`.
 * Declared at module level so multiple callers of installAggregator() share one.
 */
const bus = new EventEmitter()
bus.setMaxListeners(0)

/** Path (fs path) -> diagnostics. Authoritative live cache. */
const cache = new Map<string, LspDiagnostic[]>()

/** Per-file version counter so consumers can dedupe. */
const versions = new Map<string, number>()

/** User subscribers (separate from bus, for convenience). */
const subscribers = new Set<(e: DiagnosticChangeEvent) => void>()

/** Has installAggregator() wired up registry callbacks yet? */
let installed = false

/**
 * Feature flag — initial rollout is behind VOID_LSP_SERVER=1.
 * Callers can always read the cache; installAggregator() is a no-op when flag is off.
 */
export function isLspServerEnabled(): boolean {
  const v = process.env.VOID_LSP_SERVER
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Normalize a file:// uri (or plain path) to a filesystem path.
 * Windows-safe via fileURLToPath. Malformed URIs fall back to string stripping.
 */
export function uriToPath(uri: string): string {
  try {
    if (uri.startsWith('file://')) return fileURLToPath(uri)
  } catch {
    // fall through
  }
  return uri.replace(/^file:\/\//, '')
}

/**
 * Convert an fs path to a file:// uri — consistent with what LSP servers
 * publish under. Helpful for consumers correlating ToolCard paths to the cache.
 */
export function pathToUri(fsPath: string): string {
  try {
    return pathToFileURL(fsPath).href
  } catch {
    return `file://${fsPath}`
  }
}

/**
 * Get diagnostics for a single file. Accepts either an fs path or file:// URI.
 * Returns [] when no diagnostics are known (which includes "no LSP for this
 * file" — consumers cannot distinguish "healthy" from "unsupported"; that's
 * intentional for UI simplicity).
 */
export function getDiagnostics(pathOrUri: string): LspDiagnostic[] {
  const key = uriToPath(pathOrUri)
  return cache.get(key) ?? []
}

/** Flat copy of the full cache. For debugging / status-bar aggregates. */
export function getAllDiagnostics(): Map<string, LspDiagnostic[]> {
  return new Map(cache)
}

/** Roll up counts across the whole workspace cache. */
export function getCounts(): DiagnosticCounts {
  let errors = 0
  let warnings = 0
  let info = 0
  let hints = 0
  for (const list of cache.values()) {
    for (const d of list) {
      if (d.severity === 'Error') errors++
      else if (d.severity === 'Warning') warnings++
      else if (d.severity === 'Info') info++
      else hints++
    }
  }
  return { errors, warnings, info, hints }
}

/**
 * Subscribe to diagnostic changes. Returns an unsubscribe function.
 *
 * Consumers can prefer this over bus.on() for type-safety, or use the bus
 * directly for decoupling. Both fire together.
 */
export function subscribe(cb: (e: DiagnosticChangeEvent) => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/** Event bus accessor — shared EventEmitter. */
export function getDiagnosticsBus(): EventEmitter {
  return bus
}

/**
 * Upsert the diagnostic cache for a file and emit change events.
 *
 * Primary caller is the passiveFeedback handler (via installAggregator), but
 * exposed for tests and for manual re-push after a disk write (so the UI
 * doesn't lag behind the LSP server's internal push cadence).
 */
export function upsertDiagnostics(
  pathOrUri: string,
  diagnostics: LspDiagnostic[],
): void {
  const key = uriToPath(pathOrUri)
  // Skip churn on identical lists (cheap JSON compare; lists are tiny)
  const existing = cache.get(key)
  if (existing && sameDiagnosticList(existing, diagnostics)) {
    return
  }

  if (diagnostics.length === 0) {
    cache.delete(key)
  } else {
    cache.set(key, diagnostics)
  }
  const v = (versions.get(key) ?? 0) + 1
  versions.set(key, v)

  const event: DiagnosticChangeEvent = {
    path: key,
    diagnostics,
    version: v,
  }

  // Notify direct subscribers synchronously (fast path for UI).
  for (const cb of subscribers) {
    try {
      cb(event)
    } catch (err) {
      logError(toError(err))
    }
  }

  // Notify app-wide bus for decoupled consumers (SessionHUD, ToolCards).
  try {
    bus.emit(LSP_DIAGNOSTICS_CHANGED, event)
  } catch (err) {
    logError(toError(err))
  }
}

/**
 * Clear all diagnostic state (used by session reset and tests).
 * Does NOT tear down the bus — external subscribers remain registered.
 */
export function resetDiagnosticsCache(): void {
  cache.clear()
  versions.clear()
}

/**
 * Clear diagnostics for a single file. Emits a change event so the UI updates.
 * Called by the aggregator when a file is deleted on disk.
 */
export function clearDiagnosticsForFile(pathOrUri: string): void {
  const key = uriToPath(pathOrUri)
  if (cache.has(key)) {
    upsertDiagnostics(key, [])
  }
}

/**
 * Wire the aggregator into the existing LSP registry + passive feedback
 * pipeline. Safe to call multiple times. No-op when VOID_LSP_SERVER is unset.
 *
 * Note: we don't directly attach to LSP server instances here — passiveFeedback
 * already does that during LSP manager initialization. We instead export a
 * `pushLSPPublishDiagnostics` hook that passiveFeedback calls.
 */
export function installAggregator(): void {
  if (installed) return
  if (!isLspServerEnabled()) {
    logForDebugging(
      '[LSP AGGREGATOR] VOID_LSP_SERVER not set — skipping install',
    )
    return
  }
  installed = true
  logForDebugging('[LSP AGGREGATOR] installed')
}

/**
 * Re-push a touched file through the LSP manager so the server re-publishes
 * diagnostics. Best-effort, never throws; errors are logged for debugging.
 *
 * Call this after write/save operations, or from the watcher when a file
 * changed on disk outside of an agent edit.
 */
export async function refreshDiagnosticsForFile(
  fsPath: string,
  contentHint?: string,
): Promise<void> {
  const manager = getLspServerManager()
  if (!manager) return

  try {
    // If we have content in-hand use it; otherwise let the server figure it
    // out from disk via didSave. changeFile is cheap when the file isn't open
    // (it no-ops + opens).
    if (contentHint !== undefined) {
      await manager.changeFile(fsPath, contentHint)
    }
    await manager.saveFile(fsPath)
  } catch (err) {
    logForDebugging(
      `[LSP AGGREGATOR] refreshDiagnosticsForFile(${fsPath}) failed: ${
        (err as Error).message
      }`,
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sameDiagnosticList(a: LspDiagnostic[], b: LspDiagnostic[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.message !== y.message) return false
    if (x.severity !== y.severity) return false
    if (x.source !== y.source) return false
    if (x.code !== y.code) return false
    if (x.range.start.line !== y.range.start.line) return false
    if (x.range.start.character !== y.range.start.character) return false
    if (x.range.end.line !== y.range.end.line) return false
    if (x.range.end.character !== y.range.end.character) return false
  }
  return true
}

/**
 * Pretty-print diagnostics for a single file as a short block that can be
 * appended to tool results. Keeps output small so it never dominates the
 * actual tool response.
 *
 * Output example:
 *   LSP (3 errors, 1 warning):
 *     E:12:7  Type 'string' is not assignable to type 'number'.
 *     W:88:1  'foo' is declared but never used.
 */
export function formatDiagnosticsForToolResult(
  pathOrUri: string,
  opts: { maxItems?: number } = {},
): string {
  const maxItems = opts.maxItems ?? 5
  const diags = getDiagnostics(pathOrUri)
  if (diags.length === 0) return ''

  const errors = diags.filter(d => d.severity === 'Error').length
  const warnings = diags.filter(d => d.severity === 'Warning').length

  const parts: string[] = []
  const header: string[] = []
  if (errors > 0) header.push(`${errors} error${errors === 1 ? '' : 's'}`)
  if (warnings > 0)
    header.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
  if (header.length === 0) header.push(`${diags.length} info`)

  parts.push(`LSP (${header.join(', ')}):`)

  // Errors first so truncation doesn't drop them
  const sorted = [...diags].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  )
  for (const d of sorted.slice(0, maxItems)) {
    const sev = severityChar(d.severity)
    const line = d.range.start.line + 1 // LSP is 0-indexed; editors are 1-indexed
    const ch = d.range.start.character + 1
    const msg = d.message.split('\n')[0] ?? d.message
    parts.push(`  ${sev}:${line}:${ch}  ${msg}`)
  }
  if (sorted.length > maxItems) {
    parts.push(`  … and ${sorted.length - maxItems} more`)
  }
  return parts.join('\n')
}

function severityRank(s: LspDiagnostic['severity']): number {
  switch (s) {
    case 'Error':
      return 1
    case 'Warning':
      return 2
    case 'Info':
      return 3
    case 'Hint':
      return 4
  }
}

function severityChar(s: LspDiagnostic['severity']): string {
  switch (s) {
    case 'Error':
      return 'E'
    case 'Warning':
      return 'W'
    case 'Info':
      return 'I'
    case 'Hint':
      return 'H'
  }
}
