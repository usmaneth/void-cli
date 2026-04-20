/**
 * LSP Diagnostic Watcher
 *
 * Observes files that have been opened/edited by the agent and re-pushes
 * didChange + didSave to the LSP manager when the file changes on disk.
 * This catches external edits (another process, a formatter, `git pull`) so
 * the live diagnostic cache stays fresh without requiring explicit agent
 * action.
 *
 * Implementation note: the task spec mentioned @parcel/watcher; void-cli
 * already depends on `chokidar` (^5) for its other file-watching needs, so
 * we reuse it to avoid an extra native dependency. Chokidar works on macOS
 * (fsevents), Linux (inotify), and Windows (ReadDirectoryChangesW) — the
 * same surface @parcel/watcher covers. If the project later wants to
 * consolidate on @parcel/watcher this file is the one place to swap.
 *
 * Debouncing: 150ms per-file debounce prevents redundant LSP pushes when
 * editors save-atomic (tmp rename) triggers "unlink" + "add" in rapid
 * succession, or when tools like prettier rewrite the file twice.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import * as path from 'path'
import { logForDebugging } from './_logShim.js'
import {
  clearDiagnosticsForFile,
  isLspServerEnabled,
  refreshDiagnosticsForFile,
} from './diagnostics.js'

const DEBOUNCE_MS = 150

/** Module-singleton watcher; null when not yet started. */
let watcher: FSWatcher | null = null

/** Per-file debounce timers. */
const debounceTimers = new Map<string, NodeJS.Timeout>()

/** Tracked files — prevents re-adding the same path. */
const tracked = new Set<string>()

/**
 * Start watching a file for disk changes. Idempotent. No-op when the feature
 * flag is off, so callers can invoke unconditionally from tool handlers.
 */
export function watchFile(filePath: string): void {
  if (!isLspServerEnabled()) return
  const abs = path.resolve(filePath)
  if (tracked.has(abs)) return

  ensureWatcher()
  tracked.add(abs)
  watcher?.add(abs)
  logForDebugging(`[LSP WATCHER] tracking ${abs}`)
}

/** Stop watching a file. Rarely needed — chokidar handles deletes natively. */
export function unwatchFile(filePath: string): void {
  const abs = path.resolve(filePath)
  if (!tracked.has(abs)) return
  tracked.delete(abs)
  watcher?.unwatch(abs)
  const timer = debounceTimers.get(abs)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(abs)
  }
}

/**
 * Shut down the watcher and clear all tracked files. Called during Void
 * shutdown so fsevents / inotify descriptors are released cleanly.
 */
export async function stopWatcher(): Promise<void> {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  tracked.clear()
  if (watcher) {
    try {
      await watcher.close()
    } catch (err) {
      logForDebugging(
        `[LSP WATCHER] close failed: ${(err as Error).message}`,
      )
    }
    watcher = null
  }
}

/** Total number of files currently tracked. Used by tests & debug views. */
export function getWatchedFileCount(): number {
  return tracked.size
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function ensureWatcher(): void {
  if (watcher) return
  watcher = chokidar.watch([], {
    // We start with 0 paths and add lazily via watcher.add(); persistent:false
    // would stop the process from staying alive. Void's CLI is a long-lived
    // process so true is correct.
    persistent: true,
    // Don't re-emit adds for files that already existed when chokidar started
    // (we only care about change / unlink events going forward).
    ignoreInitial: true,
    // Poll only as a last resort — fsevents/inotify are strictly preferred.
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 20,
    },
  })

  watcher.on('change', fileChanged)
  watcher.on('unlink', fileUnlinked)
  watcher.on('error', err => {
    logForDebugging(`[LSP WATCHER] error: ${(err as Error).message}`)
  })
}

function fileChanged(filePath: string): void {
  const abs = path.resolve(filePath)
  const existing = debounceTimers.get(abs)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    debounceTimers.delete(abs)
    void refreshDiagnosticsForFile(abs).catch(() => {
      // errors are already logged inside refreshDiagnosticsForFile
    })
  }, DEBOUNCE_MS)

  debounceTimers.set(abs, timer)
}

function fileUnlinked(filePath: string): void {
  const abs = path.resolve(filePath)
  const timer = debounceTimers.get(abs)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(abs)
  }
  clearDiagnosticsForFile(abs)
  tracked.delete(abs)
}

// --- test helpers ----------------------------------------------------------

/** Reset internal state for tests (no fsevents open). */
export async function _resetWatcherForTesting(): Promise<void> {
  await stopWatcher()
}

/** Expose the debounce window so tests don't magic-number it. */
export const WATCHER_DEBOUNCE_MS = DEBOUNCE_MS
