/**
 * Background Process Manager — Proceed While Running
 *
 * Manages background processes while the agent continues working.
 * Uses only Node.js built-ins (child_process, crypto).
 */

import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BgProcessStatus = 'running' | 'stopped' | 'exited' | 'error'

export type BgProcess = {
  id: string
  command: string
  pid?: number
  status: BgProcessStatus
  startedAt: string
  stoppedAt?: string
  exitCode?: number
  outputLines: string[]
  errorLines: string[]
  maxOutputLines: number
}

export type BgProcessStartOptions = {
  /** Working directory for the spawned process. Defaults to `process.cwd()`. */
  cwd?: string
  /** Extra environment variables merged with `process.env`. */
  env?: Record<string, string>
  /** Maximum number of output/error lines to retain (circular buffer). Default 500. */
  maxOutputLines?: number
  /** Shell to use. When `true`, uses the platform default shell. Default `true`. */
  shell?: boolean | string
}

type ExitCallback = (code: number | null, signal: NodeJS.Signals | null) => void

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return randomUUID().slice(0, 6)
}

/**
 * Push a line into a circular buffer array, evicting the oldest entry when the
 * buffer exceeds `max` lines.
 */
function pushLine(buffer: string[], line: string, max: number): void {
  if (buffer.length >= max) {
    buffer.shift()
  }
  buffer.push(line)
}

/**
 * Split an incoming data chunk into individual lines and feed them into a
 * circular buffer.  Handles partial lines that span multiple `data` events by
 * tracking a remainder via the returned string.
 */
function processChunk(
  chunk: Buffer | string,
  remainder: string,
  buffer: string[],
  max: number,
): string {
  const text = remainder + chunk.toString()
  const parts = text.split('\n')
  // The last element is either an empty string (if the chunk ended with \n) or
  // an incomplete line that we carry over to the next event.
  const newRemainder = parts.pop() ?? ''
  for (const part of parts) {
    pushLine(buffer, part, max)
  }
  return newRemainder
}

// ---------------------------------------------------------------------------
// BackgroundProcessManager
// ---------------------------------------------------------------------------

export class BackgroundProcessManager {
  private processes: Map<string, BgProcess> = new Map()
  private children: Map<string, ChildProcess> = new Map()
  private exitCallbacks: Map<string, ExitCallback[]> = new Map()
  private stdoutRemainders: Map<string, string> = new Map()
  private stderrRemainders: Map<string, string> = new Map()
  private totalStarted = 0
  private totalErrors = 0
  private cleanupRegistered = false

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Spawn a command in the background.
   *
   * Returns the short process id that can be used with all other methods.
   */
  start(command: string, options?: BgProcessStartOptions): string {
    const id = generateId()
    const maxOutputLines = options?.maxOutputLines ?? 500

    const bgProcess: BgProcess = {
      id,
      command,
      status: 'running',
      startedAt: new Date().toISOString(),
      outputLines: [],
      errorLines: [],
      maxOutputLines,
    }

    this.processes.set(id, bgProcess)
    this.totalStarted++

    // Ensure we clean up child processes when the parent exits.
    this.registerCleanupHook()

    let child: ChildProcess
    try {
      child = spawn(command, {
        cwd: options?.cwd ?? process.cwd(),
        env: options?.env ? { ...process.env, ...options.env } : process.env,
        shell: options?.shell ?? true,
        detached: false,
        stdio: 'pipe',
      })
    } catch (err) {
      bgProcess.status = 'error'
      bgProcess.stoppedAt = new Date().toISOString()
      this.totalErrors++
      const message = err instanceof Error ? err.message : String(err)
      pushLine(bgProcess.errorLines, `spawn error: ${message}`, maxOutputLines)
      return id
    }

    bgProcess.pid = child.pid
    this.children.set(id, child)
    this.stdoutRemainders.set(id, '')
    this.stderrRemainders.set(id, '')

    // ------ stdout ------
    child.stdout?.on('data', (chunk: Buffer) => {
      const proc = this.processes.get(id)
      if (!proc) return
      const rem = this.stdoutRemainders.get(id) ?? ''
      this.stdoutRemainders.set(
        id,
        processChunk(chunk, rem, proc.outputLines, proc.maxOutputLines),
      )
    })

    // ------ stderr ------
    child.stderr?.on('data', (chunk: Buffer) => {
      const proc = this.processes.get(id)
      if (!proc) return
      const rem = this.stderrRemainders.get(id) ?? ''
      this.stderrRemainders.set(
        id,
        processChunk(chunk, rem, proc.errorLines, proc.maxOutputLines),
      )
    })

    // ------ error (spawn failure, etc.) ------
    child.on('error', (err: Error) => {
      const proc = this.processes.get(id)
      if (!proc) return
      proc.status = 'error'
      proc.stoppedAt = new Date().toISOString()
      this.totalErrors++
      pushLine(
        proc.errorLines,
        `process error: ${err.message}`,
        proc.maxOutputLines,
      )
      this.flushRemainders(id, proc)
      this.children.delete(id)
      this.fireExitCallbacks(id, null, null)
    })

    // ------ exit ------
    child.on('exit', (code, signal) => {
      const proc = this.processes.get(id)
      if (!proc) return
      if (proc.status === 'running') {
        proc.status = 'exited'
      }
      proc.exitCode = code ?? undefined
      proc.stoppedAt = new Date().toISOString()
      if (code !== null && code !== 0) {
        this.totalErrors++
      }
      this.flushRemainders(id, proc)
      this.children.delete(id)
      this.fireExitCallbacks(id, code, signal)
    })

    // ------ close (all stdio streams finished) ------
    child.on('close', () => {
      const proc = this.processes.get(id)
      if (proc) {
        this.flushRemainders(id, proc)
      }
      this.children.delete(id)
    })

    return id
  }

  /**
   * Stop a background process.  Sends SIGTERM first, then SIGKILL after 5 s.
   */
  async stop(id: string): Promise<boolean> {
    const child = this.children.get(id)
    const proc = this.processes.get(id)
    if (!child || !proc) return false

    return new Promise<boolean>(resolve => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already dead
        }
      }, 5_000)

      const onDone = () => {
        clearTimeout(killTimer)
        proc.status = 'stopped'
        proc.stoppedAt = new Date().toISOString()
        resolve(true)
      }

      // If the child exits before the timeout, clear the kill timer.
      child.once('exit', onDone)
      child.once('error', onDone)

      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(killTimer)
        resolve(false)
      }
    })
  }

  /**
   * Stop all running background processes.
   */
  async stopAll(): Promise<void> {
    const ids = [...this.children.keys()]
    await Promise.allSettled(ids.map(id => this.stop(id)))
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * List all tracked processes (running and exited).
   */
  list(): BgProcess[] {
    return [...this.processes.values()]
  }

  /**
   * Get a single process by id, or `undefined` if not found.
   */
  getProcess(id: string): BgProcess | undefined {
    return this.processes.get(id)
  }

  /**
   * Return the last `tail` lines of stdout for a process.
   */
  getLogs(id: string, tail = 50): string[] {
    const proc = this.processes.get(id)
    if (!proc) return []
    return proc.outputLines.slice(-tail)
  }

  /**
   * Return all captured stderr lines for a process.
   */
  getErrors(id: string): string[] {
    const proc = this.processes.get(id)
    if (!proc) return []
    return [...proc.errorLines]
  }

  /**
   * Check whether a process is still running.
   */
  isRunning(id: string): boolean {
    const proc = this.processes.get(id)
    return proc?.status === 'running'
  }

  /**
   * Remove all exited / stopped / errored processes from the internal list.
   */
  cleanup(): number {
    let removed = 0
    for (const [id, proc] of this.processes) {
      if (proc.status !== 'running') {
        this.processes.delete(id)
        this.exitCallbacks.delete(id)
        this.stdoutRemainders.delete(id)
        this.stderrRemainders.delete(id)
        removed++
      }
    }
    return removed
  }

  /**
   * Aggregate statistics about managed processes.
   */
  getStats(): { running: number; totalStarted: number; errors: number } {
    let running = 0
    for (const proc of this.processes.values()) {
      if (proc.status === 'running') running++
    }
    return { running, totalStarted: this.totalStarted, errors: this.totalErrors }
  }

  /**
   * Register a callback that fires when a process exits.
   *
   * If the process has already exited, the callback is invoked immediately
   * (asynchronously via `queueMicrotask`).
   */
  onExit(id: string, callback: ExitCallback): void {
    const proc = this.processes.get(id)
    if (!proc) return

    if (proc.status !== 'running') {
      // Already finished — fire immediately (async to keep semantics consistent).
      queueMicrotask(() =>
        callback(proc.exitCode ?? null, null),
      )
      return
    }

    const cbs = this.exitCallbacks.get(id) ?? []
    cbs.push(callback)
    this.exitCallbacks.set(id, cbs)
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Flush any partial line data still sitting in the remainder buffers.
   */
  private flushRemainders(id: string, proc: BgProcess): void {
    const stdoutRem = this.stdoutRemainders.get(id)
    if (stdoutRem) {
      pushLine(proc.outputLines, stdoutRem, proc.maxOutputLines)
      this.stdoutRemainders.set(id, '')
    }
    const stderrRem = this.stderrRemainders.get(id)
    if (stderrRem) {
      pushLine(proc.errorLines, stderrRem, proc.maxOutputLines)
      this.stderrRemainders.set(id, '')
    }
  }

  /**
   * Invoke and clean up registered exit callbacks for a process.
   */
  private fireExitCallbacks(
    id: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const cbs = this.exitCallbacks.get(id)
    if (!cbs) return
    this.exitCallbacks.delete(id)
    for (const cb of cbs) {
      try {
        cb(code, signal)
      } catch {
        // Swallow errors in user callbacks to avoid crashing the manager.
      }
    }
  }

  /**
   * Register a one-time `process.on('exit')` handler that stops all children.
   */
  private registerCleanupHook(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true
    process.on('exit', () => {
      // `process.on('exit')` handlers must be synchronous — send SIGTERM
      // directly rather than going through the async `stop()` method.
      for (const child of this.children.values()) {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: BackgroundProcessManager | undefined

export function getBackgroundProcessManager(): BackgroundProcessManager {
  if (!instance) {
    instance = new BackgroundProcessManager()
  }
  return instance
}
