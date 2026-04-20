/**
 * Historical Diagnostic Snapshots
 *
 * Captures a frozen copy of diagnostics *at the moment a tool executed* so
 * that when a past FileEdit / FileWrite is re-rendered in the transcript, the
 * UI can show the diagnostics that were present at that time — not the
 * (possibly stale, possibly empty) current cache.
 *
 * Snapshots are keyed by tool-use-id so they collide-free across a session,
 * and are kept lean (plain-object copies; no EventEmitter wiring).
 *
 * When the feature flag is off, capture is a no-op and lookups return null.
 * Consumers should render "diagnostics not recorded" when `getSnapshot()`
 * returns null.
 */

import { getDiagnostics, type LspDiagnostic } from './diagnostics.js'
import { isInlineDiagnosticsEnabled } from './overlay.js'

export type DiagnosticSnapshot = {
  /** Absolute file path the snapshot was taken for. */
  path: string
  /** Deep-copied diagnostic list. Safe to persist/serialize. */
  diagnostics: LspDiagnostic[]
  /** Epoch ms when the snapshot was captured. */
  capturedAt: number
}

/**
 * In-memory snapshot store. LRU-shaped soft cap — we drop oldest entries
 * when we exceed the limit so a 10k-turn session doesn't retain forever.
 */
const MAX_SNAPSHOTS = 1000
const snapshots = new Map<string, DiagnosticSnapshot>()

/**
 * Capture the current diagnostic cache for a file under a stable key
 * (typically a tool-use-id). Returns the snapshot that was stored, or null
 * when the feature flag is off.
 */
export function captureDiagnosticsSnapshot(
  key: string,
  filePath: string,
): DiagnosticSnapshot | null {
  if (!isInlineDiagnosticsEnabled()) return null
  const live = getDiagnostics(filePath)
  const snap: DiagnosticSnapshot = {
    path: filePath,
    diagnostics: live.map(cloneDiagnostic),
    capturedAt: Date.now(),
  }
  if (snapshots.size >= MAX_SNAPSHOTS) {
    // Drop the oldest entry. `Map` insertion order = age order.
    const oldestKey = snapshots.keys().next().value
    if (oldestKey !== undefined) snapshots.delete(oldestKey)
  }
  snapshots.set(key, snap)
  return snap
}

/**
 * Retrieve a previously-captured snapshot. Returns null when none was
 * recorded (tool predates the flag being on, or the flag is currently off).
 */
export function getSnapshot(key: string): DiagnosticSnapshot | null {
  return snapshots.get(key) ?? null
}

/** True when a snapshot exists for the given key. */
export function hasSnapshot(key: string): boolean {
  return snapshots.has(key)
}

/** Clear the store. Used on session reset and by tests. */
export function resetSnapshots(): void {
  snapshots.clear()
}

/** Expose the count for assertions in tests. */
export function _snapshotCount(): number {
  return snapshots.size
}

function cloneDiagnostic(d: LspDiagnostic): LspDiagnostic {
  return {
    message: d.message,
    severity: d.severity,
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    source: d.source,
    code: d.code,
  }
}
