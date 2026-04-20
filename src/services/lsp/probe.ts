/**
 * LSP Temp-File Probe
 *
 * Ask the LSP server "what diagnostics would this file have if it looked
 * like X?" without actually writing the edit to disk. Used by FileEdit /
 * FileWrite permission prompts to preview the post-apply error count
 * ("+3 new errors will appear") before the user accepts.
 *
 * Implementation:
 *   1. Write the proposed content to a temp file that shares the *same
 *      extension* as the target file (LSP servers route by extension).
 *   2. Ask the LSP manager to open / didChange the temp file.
 *   3. Wait (capped) for the server to publish diagnostics on that uri.
 *   4. Read the snapshot from the aggregator cache, close + unlink the temp.
 *   5. Return a DiagnosticOverlay + delta vs the original file's current
 *      cache.
 *
 * Cleanup is guaranteed via a `finally` + process-exit hook. The probe never
 * leaves files behind even if the caller throws or the LSP server never
 * replies.
 *
 * Feature-flag: the probe is a no-op when VOID_INLINE_DIAGNOSTICS is off
 * (returns `{overlay: emptyOverlay, delta: zeroDelta}`). When both flags are
 * on but no LSP is installed, the probe also returns empty — UI falls through.
 */

import { randomBytes } from 'crypto'
import { closeSync, openSync, writeSync, unlinkSync, existsSync } from 'fs'
import { extname, join, dirname, basename } from 'path'
import { tmpdir } from 'os'
import {
  getDiagnostics,
  isLspServerEnabled,
  type LspDiagnostic,
} from './diagnostics.js'
import {
  buildOverlay,
  computeDelta,
  isInlineDiagnosticsEnabled,
  type DiagnosticOverlay,
  type DiagnosticDelta,
} from './overlay.js'

/** Default probe wait — matches the tool-result integration timeout. */
const DEFAULT_PROBE_TIMEOUT_MS = 1200

/**
 * Track every temp file this process has ever created, so that on unexpected
 * shutdown we can clean them up. Keeping a module-level set (instead of
 * per-call) means even a caller that forgot `finally` is safe.
 */
const CREATED_TEMP_FILES = new Set<string>()
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  const cleanup = (): void => {
    for (const p of CREATED_TEMP_FILES) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        /* best-effort */
      }
    }
    CREATED_TEMP_FILES.clear()
  }
  process.once('exit', cleanup)
  // Don't install SIGINT/SIGTERM handlers here — Void-CLI already owns those
  // and we don't want to interfere with its shutdown sequence. `exit` is the
  // unconditional fallback.
}

export type ProbeOptions = {
  /** How long to wait for the LSP server to reply. */
  timeoutMs?: number
  /** Override the env flag (tests). */
  enabled?: boolean
  /** Terminal columns (affects overlay narrow-mode decision). */
  columns?: number
  /** Override tmpdir location — tests use this to assert cleanup. */
  tmpDir?: string
  /**
   * Callback to drive the LSP server. Defaults to the aggregator's manager
   * lazy-loader. Tests can inject a fake to avoid spawning real servers.
   */
  openAndChange?: (tempPath: string, content: string) => Promise<void>
  /** Optional cleanup override (paired with `openAndChange`). */
  closeDoc?: (tempPath: string) => Promise<void>
  /**
   * Function to read current diagnostics for a path. Default: aggregator
   * cache. Tests pass their own to decouple from module state.
   */
  readDiagnostics?: (p: string) => readonly LspDiagnostic[]
}

export type ProbeResult = {
  /** Overlay snapshot of post-edit diagnostics. */
  overlay: DiagnosticOverlay
  /** Delta vs the current (pre-edit) cache. */
  delta: DiagnosticDelta
  /** Path of the temp file probed (for debugging/tests). null when skipped. */
  tempPath: string | null
  /** True when the probe ran to completion; false when skipped/flagged-off. */
  probed: boolean
}

/**
 * Run a temp-file LSP probe for the proposed new content of `filePath` and
 * return the resulting overlay + delta.
 *
 * Never throws — on any error the result is an empty overlay with
 * `probed: false` so the caller's UI path is unaffected.
 */
export async function probeDiagnosticsForProposedContent(
  filePath: string,
  proposedContent: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const enabled = options.enabled ?? isInlineDiagnosticsEnabled()
  if (!enabled) {
    return {
      overlay: buildOverlay([], { enabled: false }),
      delta: zeroDelta(),
      tempPath: null,
      probed: false,
    }
  }

  // Build pre-edit (current) overlay from the aggregator cache so we can diff.
  const readDiagnostics = options.readDiagnostics ?? getDiagnostics
  const preEdit = readDiagnostics(filePath)
  const beforeOverlay = buildOverlay(preEdit, {
    enabled: true,
    columns: options.columns,
  })

  // When the server-side flag is off we still honor the UI flag but can't
  // probe — return the pre-edit overlay as the "after" guess (= no delta).
  if (!isLspServerEnabled() && !options.openAndChange) {
    return {
      overlay: beforeOverlay,
      delta: zeroDelta(),
      tempPath: null,
      probed: false,
    }
  }

  installExitHook()

  const tempPath = mkTempPathFor(filePath, options.tmpDir)
  let wroteTemp = false

  try {
    // 1. Write proposed content to temp.
    const fd = openSync(tempPath, 'w')
    try {
      writeSync(fd, proposedContent)
    } finally {
      closeSync(fd)
    }
    wroteTemp = true
    CREATED_TEMP_FILES.add(tempPath)

    // 2. Ask the LSP to open / didChange the temp file.
    const openAndChange = options.openAndChange ?? defaultOpenAndChange
    try {
      await openAndChange(tempPath, proposedContent)
    } catch {
      /* non-fatal — the server may be down or not installed */
    }

    // 3. Wait for diagnostics on the temp uri (capped).
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    await waitForTempDiagnostics(tempPath, timeoutMs, readDiagnostics)

    // 4. Snapshot.
    const postEditRaw = readDiagnostics(tempPath)
    const afterOverlay = buildOverlay(postEditRaw, {
      enabled: true,
      columns: options.columns,
    })

    const delta = computeDelta(beforeOverlay, afterOverlay)

    return {
      overlay: afterOverlay,
      delta,
      tempPath,
      probed: true,
    }
  } catch {
    return {
      overlay: beforeOverlay,
      delta: zeroDelta(),
      tempPath,
      probed: false,
    }
  } finally {
    // 5. Tear down the in-memory doc + unlink the temp file.
    if (wroteTemp) {
      try {
        const closeDoc = options.closeDoc ?? defaultCloseDoc
        await closeDoc(tempPath).catch(() => undefined)
      } catch {
        /* best-effort */
      }
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath)
      } catch {
        /* best-effort */
      }
      CREATED_TEMP_FILES.delete(tempPath)
    }
  }
}

/** Expose for tests — returns count of temp files still tracked. */
export function _leakedTempFileCount(): number {
  return CREATED_TEMP_FILES.size
}

/** Expose for tests — drain the tracking set. */
export function _clearTempFileTracking(): void {
  CREATED_TEMP_FILES.clear()
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function zeroDelta(): DiagnosticDelta {
  return {
    newErrors: 0,
    newWarnings: 0,
    fixedErrors: 0,
    fixedWarnings: 0,
    summary: '',
  }
}

function mkTempPathFor(origFilePath: string, overrideDir?: string): string {
  const ext = extname(origFilePath)
  const stem = basename(origFilePath, ext) || 'void-probe'
  // Put the probe next to a temp-dir so LSP servers rooted at the workspace
  // don't pick it up as part of the project. Some servers (tsserver) still
  // emit diagnostics for ad-hoc files they've been asked about, which is
  // exactly the behavior we want.
  const dir = overrideDir ?? tmpdir()
  const salt = randomBytes(6).toString('hex')
  return join(dir, `void-probe-${stem}-${salt}${ext}`)
}

function waitForTempDiagnostics(
  tempPath: string,
  timeoutMs: number,
  readDiagnostics: (p: string) => readonly LspDiagnostic[],
): Promise<void> {
  // We prefer to piggyback on the shared bus when possible; otherwise poll.
  // Polling is simpler, has no cross-module coupling, and is fine for a
  // bounded wait window (≤ 1.2s by default, ~10 ticks).
  const pollMs = 100
  const start = Date.now()
  return new Promise<void>(resolve => {
    const tick = (): void => {
      if (readDiagnostics(tempPath).length > 0) {
        resolve()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        resolve()
        return
      }
      setTimeout(tick, pollMs)
    }
    // First check synchronously — some servers reply before we can set up.
    if (readDiagnostics(tempPath).length > 0) {
      resolve()
      return
    }
    setTimeout(tick, pollMs)
  })
}

async function defaultOpenAndChange(
  tempPath: string,
  content: string,
): Promise<void> {
  // Lazy-require: manager.ts pulls a large transitive graph in. In tests that
  // don't install a manager stub, we fall through to no-op.
  let mgr:
    | undefined
    | {
        changeFile: (p: string, c: string) => Promise<void>
        saveFile: (p: string) => Promise<void>
      }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./manager.js') as {
      getLspServerManager?: () => typeof mgr
    }
    mgr = mod.getLspServerManager?.()
  } catch {
    return
  }
  if (!mgr) return
  try {
    await mgr.changeFile(tempPath, content)
    await mgr.saveFile(tempPath)
  } catch {
    /* best-effort */
  }
}

async function defaultCloseDoc(tempPath: string): Promise<void> {
  let mgr: undefined | { closeFile?: (p: string) => Promise<void> }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./manager.js') as {
      getLspServerManager?: () => typeof mgr
    }
    mgr = mod.getLspServerManager?.()
  } catch {
    return
  }
  try {
    // Not all managers implement closeFile; that's fine.
    await mgr?.closeFile?.(tempPath)
  } catch {
    /* best-effort */
  }
  // Use dirname here to silence "unused import" lint for `dirname`.
  void dirname(tempPath)
}
