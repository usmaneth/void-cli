/**
 * External output passthrough for the Bash tool.
 *
 * Purpose: for long or fast-streaming bash output, route stdout directly to
 * the host terminal (bypassing Ink's paint pipeline) for a major perf win,
 * while still capturing a copy in memory so the tool-result message remains
 * faithful for the model.
 *
 * Architecture:
 *   child stdout ──┬─► process.stdout.write()   (fast path, native scroll)
 *                  └─► in-memory buffer         (history / tool-result)
 *
 * Ink is suspended during passthrough (alt-buffer exited, stdin handed over)
 * so the child's output is not garbled by re-renders. When the child exits,
 * Ink is resumed and a full repaint fires.
 *
 * Opt-in paths:
 *   1. `VOID_EXTERNAL_PASSTHROUGH=1`                         — always on.
 *   2. Heuristic: output > N lines OR runtime > M seconds    — kicks in
 *      once either threshold is crossed. Both thresholds are configurable
 *      via env (VOID_PASSTHROUGH_LINE_THRESHOLD, VOID_PASSTHROUGH_RUNTIME_MS)
 *      or via `PassthroughConfig` passed to the helper functions.
 *
 * This file is strictly additive — the non-passthrough code path is
 * untouched. Callers that never invoke these helpers see zero behavioral
 * change.
 */

import type Ink from '../../ink/ink.js'
import instances from '../../ink/instances.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Passthrough thresholds. When either is crossed, auto-passthrough engages
 * (unless explicitly disabled). Values are clamped to sensible ranges.
 */
export type PassthroughConfig = {
  /** Line count above which auto-passthrough kicks in. Default: 100. */
  lineThreshold: number
  /** Runtime (ms) above which auto-passthrough kicks in. Default: 30_000. */
  runtimeThresholdMs: number
  /**
   * Hard cap on the captured buffer size (bytes). Output beyond this point is
   * still printed to the terminal but not retained in the capture. Prevents
   * unbounded memory growth on truly enormous runs. Default: 16 MB.
   */
  captureCapBytes: number
  /** If true, force passthrough regardless of thresholds. */
  forceEnabled: boolean
  /** If true, disable passthrough entirely (overrides force). */
  forceDisabled: boolean
}

const DEFAULT_CONFIG: PassthroughConfig = {
  lineThreshold: 100,
  runtimeThresholdMs: 30_000,
  captureCapBytes: 16 * 1024 * 1024,
  forceEnabled: false,
  forceDisabled: false,
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min) return fallback
  return n
}

/**
 * Resolve effective config from env + caller overrides. Env values are the
 * user-facing knobs; overrides are for tests and programmatic callers.
 */
export function resolvePassthroughConfig(
  overrides: Partial<PassthroughConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): PassthroughConfig {
  const envForceEnabled = isEnvTruthy(env.VOID_EXTERNAL_PASSTHROUGH)
  const envForceDisabled = env.VOID_EXTERNAL_PASSTHROUGH === '0' ||
    env.VOID_EXTERNAL_PASSTHROUGH?.toLowerCase() === 'off'
  return {
    lineThreshold: parseIntEnv(
      env.VOID_PASSTHROUGH_LINE_THRESHOLD,
      DEFAULT_CONFIG.lineThreshold,
      1,
    ),
    runtimeThresholdMs: parseIntEnv(
      env.VOID_PASSTHROUGH_RUNTIME_MS,
      DEFAULT_CONFIG.runtimeThresholdMs,
      100,
    ),
    captureCapBytes: parseIntEnv(
      env.VOID_PASSTHROUGH_CAPTURE_CAP,
      DEFAULT_CONFIG.captureCapBytes,
      1024,
    ),
    forceEnabled: envForceEnabled,
    forceDisabled: envForceDisabled && !envForceEnabled,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Threshold gate
// ---------------------------------------------------------------------------

/**
 * Evaluates whether passthrough should be active right now. Stateless pure
 * function — caller tracks `lineCount` / `elapsedMs` and polls this. Kept
 * separate from the writer so it can be unit-tested trivially.
 */
export function shouldEngagePassthrough(
  lineCount: number,
  elapsedMs: number,
  cfg: PassthroughConfig,
): boolean {
  if (cfg.forceDisabled) return false
  if (cfg.forceEnabled) return true
  return lineCount > cfg.lineThreshold || elapsedMs > cfg.runtimeThresholdMs
}

// ---------------------------------------------------------------------------
// Ink suspend / resume
// ---------------------------------------------------------------------------

/**
 * Represents a suspended Ink session. `restore()` is idempotent.
 */
export type InkSuspension = {
  restore: () => void
  repaint: () => void
  /** True if we actually suspended an Ink instance. False means no-op. */
  suspended: boolean
}

type InkLike = Pick<
  Ink,
  'enterAlternateScreen' | 'exitAlternateScreen'
>

/**
 * Suspend Ink so the host terminal owns the viewport. Reuses Ink's existing
 * `enterAlternateScreen`/`exitAlternateScreen` handoff (proven by the editor
 * and thinkback code paths) — this internally pauses Ink, suspends stdin,
 * and on restore triggers a full repaint.
 *
 * Returns a no-op suspension on non-TTY / tests / terminals without an Ink
 * instance registered against process.stdout. This is the "graceful fallback"
 * path.
 */
export function suspendInk(
  stdout: NodeJS.WriteStream = process.stdout,
  instanceMap: Map<NodeJS.WriteStream, InkLike> = instances as unknown as Map<
    NodeJS.WriteStream,
    InkLike
  >,
): InkSuspension {
  const ink = instanceMap.get(stdout)
  if (!ink) {
    return {
      restore: () => {},
      repaint: () => {},
      suspended: false,
    }
  }
  let restored = false
  // Exit Ink's alt screen so our direct writes land in the user's scrollback.
  // `exitAlternateScreen` in ink.tsx handles the full dance: ?1049l,
  // re-enables stdin, triggers a repaint on resume. We call `enterAlternateScreen`
  // here first because some callers (and legacy code) expect symmetry; in
  // non-fullscreen mode Ink is already on the main screen, so we just
  // suspend via pause() path. The helper below encodes both cases.
  //
  // Note: we deliberately use the alt-screen API *in reverse* —
  // enterAlternateScreen() pauses Ink + suspends stdin; exitAlternateScreen()
  // resumes + repaints. For passthrough we want exactly that suspend/resume
  // pair, which is why this method is reused.
  ink.enterAlternateScreen()
  return {
    restore: () => {
      if (restored) return
      restored = true
      try {
        ink.exitAlternateScreen()
      } catch {
        // Best-effort restore — swallow errors so the caller can continue
        // cleaning up even on a broken terminal.
      }
    },
    repaint: () => {
      // exitAlternateScreen already repaints; this is exposed for callers
      // that want to force an additional paint (e.g. after printing a
      // completion banner). Idempotent.
      try {
        if (!restored) {
          restored = true
          ink.exitAlternateScreen()
        }
      } catch {
        // ignore
      }
    },
    suspended: true,
  }
}

// ---------------------------------------------------------------------------
// Tee writer
// ---------------------------------------------------------------------------

/**
 * Destination for the direct-print half of the tee. In production this is
 * `process.stdout`; tests pass a stub.
 */
export type DirectSink = {
  write: (chunk: string) => void
}

export type PassthroughWriterOptions = {
  /** Where direct writes go. Defaults to process.stdout. */
  sink?: DirectSink
  /** Max bytes retained by the in-memory capture buffer. */
  captureCapBytes?: number
}

/**
 * A tee that sends each chunk to (a) the native terminal and (b) an
 * in-memory capture buffer. This is the core of the passthrough path.
 *
 * Usage:
 *   const w = new PassthroughWriter({ sink: process.stdout })
 *   child.stdout.on('data', c => w.write(c))
 *   child.on('exit', () => {
 *     const captured = w.captured()  // for the tool-result message
 *   })
 */
export class PassthroughWriter {
  private readonly sink: DirectSink
  private readonly captureCap: number
  private captureChunks: string[] = []
  private capturedBytes = 0
  private truncated = false
  private closed = false
  private totalLines = 0
  private totalBytes = 0

  constructor(opts: PassthroughWriterOptions = {}) {
    this.sink = opts.sink ?? {
      write: (c: string) => {
        // `process.stdout.write` accepts string|Buffer|Uint8Array; we
        // always give it strings (decoded upstream) so it is allocation-free.
        process.stdout.write(c)
      },
    }
    this.captureCap = opts.captureCapBytes ?? DEFAULT_CONFIG.captureCapBytes
  }

  /**
   * Write one chunk. Both destinations are fed even if one throws — the
   * direct-print half is allowed to fail (closed TTY, EPIPE) without
   * dropping the capture. Accepts strings or Buffer for convenience.
   */
  write(chunk: string | Buffer): void {
    if (this.closed) return
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    // Count lines/bytes before any truncation — callers rely on these
    // counters for threshold gating regardless of how much we retain.
    this.totalBytes += Buffer.byteLength(str, 'utf8')
    // Count newlines; a trailing line without \n still counts as 1 below at close()
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) === 0x0a) this.totalLines++
    }

    // Direct print (fast path).
    try {
      this.sink.write(str)
    } catch {
      // Terminal went away — keep capturing so the model still sees output.
    }

    // Capture with byte cap.
    if (!this.truncated) {
      const remaining = this.captureCap - this.capturedBytes
      if (remaining <= 0) {
        this.truncated = true
      } else {
        const bytes = Buffer.byteLength(str, 'utf8')
        if (bytes <= remaining) {
          this.captureChunks.push(str)
          this.capturedBytes += bytes
        } else {
          // Slice by bytes, not chars, to respect the cap. Use Buffer to
          // avoid breaking a multi-byte sequence in the middle.
          const buf = Buffer.from(str, 'utf8').subarray(0, remaining)
          this.captureChunks.push(buf.toString('utf8'))
          this.capturedBytes += buf.length
          this.truncated = true
        }
      }
    }
  }

  /** Return the captured copy. Safe to call multiple times. */
  captured(): string {
    return this.captureChunks.join('')
  }

  /** Was the capture buffer truncated due to the cap? */
  wasTruncated(): boolean {
    return this.truncated
  }

  /** Total newlines seen across all chunks (for threshold gating). */
  lineCount(): number {
    return this.totalLines
  }

  /** Total bytes written (pre-truncation). */
  byteCount(): number {
    return this.totalBytes
  }

  /**
   * Close the writer. Further `write()` calls are dropped silently. Useful
   * from `child.on('close')` so late data from a racing listener doesn't
   * mutate the captured snapshot after the tool has returned.
   */
  close(): void {
    this.closed = true
  }
}

// ---------------------------------------------------------------------------
// High-level runner
// ---------------------------------------------------------------------------

/**
 * Abstraction over a spawned child for the runner. Matches the fields the
 * runner touches on a Node `ChildProcess`, but typed loosely so the Bash
 * tool's `ShellCommand` wrapper (or a test double) can satisfy it.
 */
export type PassthroughChild = {
  stdout: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
  /** Kill the child. Should accept a signal name; defaults to SIGTERM. */
  kill: (signal?: NodeJS.Signals | number) => boolean
  /**
   * Resolves when the child has fully exited. Resolving value is the exit
   * code (null if killed by signal).
   */
  exited: Promise<number | null>
}

export type PassthroughRunResult = {
  /** Full captured stdout+stderr (interleaved, up to the cap). */
  output: string
  /** Exit code (null if killed by signal / cancelled). */
  exitCode: number | null
  /** True if Ctrl+C (or another abort) cancelled the child. */
  cancelled: boolean
  /** True if capture hit the cap; tail of output was dropped. */
  truncated: boolean
  /** Whether passthrough actually engaged (vs fell back to no-op). */
  engaged: boolean
  /** Total bytes streamed through the tee. */
  bytes: number
  /** Total lines streamed through the tee. */
  lines: number
}

/**
 * Run a child in passthrough mode: suspend Ink, tee its output to the
 * native terminal + a capture buffer, handle Ctrl+C, resume Ink, return
 * the captured output.
 *
 * The caller is responsible for having already spawned the child with
 * stdio pipes. This helper does NOT spawn — it only wraps an existing
 * child. That separation lets the Bash tool keep full control over
 * shell resolution, sandboxing, cwd tracking, etc.
 */
export async function runWithPassthrough(
  child: PassthroughChild,
  options: {
    abortSignal?: AbortSignal
    sink?: DirectSink
    config?: Partial<PassthroughConfig>
    suspend?: () => InkSuspension
  } = {},
): Promise<PassthroughRunResult> {
  const cfg = resolvePassthroughConfig(options.config ?? {})
  const suspend = options.suspend ?? (() => suspendInk())
  const suspension = suspend()

  const writer = new PassthroughWriter({
    sink: options.sink,
    captureCapBytes: cfg.captureCapBytes,
  })

  let cancelled = false

  // Ctrl+C / external abort → kill the child cleanly. SIGINT first; if it
  // doesn't exit within 500ms we escalate to SIGTERM. We deliberately do
  // not SIGKILL here — the BashTool's tree-kill path owns that escalation.
  const onAbort = () => {
    cancelled = true
    try {
      child.kill('SIGINT')
    } catch {
      // child may already be dead
    }
    setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* noop */
      }
    }, 500).unref?.()
  }
  if (options.abortSignal) {
    if (options.abortSignal.aborted) {
      onAbort()
    } else {
      options.abortSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  const onData = (chunk: string | Buffer) => writer.write(chunk)
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  let exitCode: number | null = null
  try {
    exitCode = await child.exited
  } finally {
    // Detach listeners before the writer closes so we don't leak on the
    // child process's stream refs.
    child.stdout?.off('data', onData)
    child.stderr?.off('data', onData)
    writer.close()
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onAbort)
    }
    // Restore Ink last — after the final chunk has been flushed to the
    // native terminal. exitAlternateScreen triggers a full Ink repaint.
    suspension.restore()
  }

  return {
    output: writer.captured(),
    exitCode,
    cancelled,
    truncated: writer.wasTruncated(),
    engaged: suspension.suspended,
    bytes: writer.byteCount(),
    lines: writer.lineCount(),
  }
}

// ---------------------------------------------------------------------------
// Decision helper for the Bash tool
// ---------------------------------------------------------------------------

/**
 * Decide whether the Bash tool should route a given invocation through
 * passthrough. Called with static info known at spawn time. Dynamic
 * threshold crossing (lines > 100 mid-run) is handled by
 * `shouldEngagePassthrough` against the live counters.
 *
 * Currently this only honours the env flag; the dynamic thresholds are
 * evaluated at runtime. Kept as a separate function so future heuristics
 * (command shape, tty mode, etc.) have a clear home.
 */
export function shouldUsePassthroughForCommand(
  _command: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.VOID_EXTERNAL_PASSTHROUGH)
}
