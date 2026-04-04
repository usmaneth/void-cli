/**
 * Watch mode system with auto-lint and auto-test feedback loops.
 *
 * Uses only Node.js built-in modules (node:fs, node:path, node:child_process).
 * Provides:
 *   - FileWatcher: recursive file system watcher with debouncing
 *   - LintTestRunner: lint/test command execution with error parsing
 *   - WatchModeManager: orchestrator tying watcher + runner together
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { minimatch } from './minimatch.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchConfig {
  /** Glob patterns to watch (default: ['src/**\/*', 'lib/**\/*']) */
  patterns: string[]
  /** Patterns to ignore (default: ['node_modules', '.git', 'dist']) */
  ignore: string[]
  /** Lint command, e.g. 'npm run lint' */
  lintCommand?: string
  /** Test command, e.g. 'npm test' */
  testCommand?: string
  /** Whether to auto-feed errors to AI (default: false) */
  autoFix: boolean
  /** Debounce file changes in milliseconds (default: 500) */
  debounceMs: number
  /** Comment pattern that triggers AI (default: 'AI:') */
  triggerComment: string
}

export interface ParsedError {
  file: string
  line: number
  message: string
  severity: 'error' | 'warning'
}

export interface RunResult {
  success: boolean
  output: string
  errors: ParsedError[]
}

export interface AIComment {
  file: string
  line: number
  comment: string
}

export interface WatchStatus {
  watching: boolean
  filesWatched: number
  lastChange: Date | null
  errorCount: number
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export function createDefaultConfig(overrides?: Partial<WatchConfig>): WatchConfig {
  return {
    patterns: ['src/**/*', 'lib/**/*'],
    ignore: ['node_modules', '.git', 'dist'],
    lintCommand: undefined,
    testCommand: undefined,
    autoFix: false,
    debounceMs: 500,
    triggerComment: 'AI:',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// FileWatcher
// ---------------------------------------------------------------------------

type OnChangeCallback = (files: string[]) => void
type OnErrorCallback = (err: Error) => void

export class FileWatcher {
  private watchers: fs.FSWatcher[] = []
  private changedFiles: Set<string> = new Set()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private config: WatchConfig
  private rootDir: string
  private _onChangeCallbacks: OnChangeCallback[] = []
  private _onErrorCallbacks: OnErrorCallback[] = []
  private _running = false

  constructor(rootDir: string, config: WatchConfig) {
    this.rootDir = path.resolve(rootDir)
    this.config = config
  }

  /** Register a callback invoked with the list of changed files after debounce. */
  onChange(cb: OnChangeCallback): void {
    this._onChangeCallbacks.push(cb)
  }

  /** Register a callback invoked when a watcher error occurs. */
  onError(cb: OnErrorCallback): void {
    this._onErrorCallbacks.push(cb)
  }

  /** Start watching. */
  start(): void {
    if (this._running) return
    this._running = true

    // Determine which top-level directories to watch based on patterns.
    const dirsToWatch = this.resolveWatchDirs()

    for (const dir of dirsToWatch) {
      try {
        const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename) return

          const fullPath = path.join(dir, filename)
          const relPath = path.relative(this.rootDir, fullPath)

          // Check ignore list
          if (this.shouldIgnore(relPath)) return

          // Check if it matches any watch pattern
          if (!this.matchesPatterns(relPath)) return

          this.changedFiles.add(relPath)
          this.scheduleFlush()
        })

        watcher.on('error', (err) => {
          for (const cb of this._onErrorCallbacks) {
            cb(err)
          }
        })

        this.watchers.push(watcher)
      } catch (err) {
        // Directory might not exist — that is fine, skip it.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          for (const cb of this._onErrorCallbacks) {
            cb(err instanceof Error ? err : new Error(String(err)))
          }
        }
      }
    }
  }

  /** Stop watching and clean up. */
  stop(): void {
    this._running = false
    for (const w of this.watchers) {
      w.close()
    }
    this.watchers = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.changedFiles.clear()
  }

  /** Returns the set of files changed since the last flush. */
  getChangedFiles(): string[] {
    return [...this.changedFiles]
  }

  /** Returns whether the watcher is running. */
  isRunning(): boolean {
    return this._running
  }

  // -- private helpers --

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.flush()
    }, this.config.debounceMs)
  }

  private flush(): void {
    if (this.changedFiles.size === 0) return
    const files = [...this.changedFiles]
    this.changedFiles.clear()
    for (const cb of this._onChangeCallbacks) {
      cb(files)
    }
  }

  private shouldIgnore(relPath: string): boolean {
    for (const pattern of this.config.ignore) {
      // Match if any path segment equals the ignore pattern, or glob-match
      const segments = relPath.split(path.sep)
      if (segments.some((s) => s === pattern)) return true
      if (minimatch(relPath, pattern)) return true
      if (minimatch(relPath, `${pattern}/**`)) return true
    }
    return false
  }

  private matchesPatterns(relPath: string): boolean {
    // If no patterns specified, match everything not ignored
    if (this.config.patterns.length === 0) return true
    for (const pattern of this.config.patterns) {
      if (minimatch(relPath, pattern)) return true
    }
    return false
  }

  /**
   * Determine which directories to actually watch based on patterns.
   * Extracts the root segment from each glob pattern and watches those directories.
   */
  private resolveWatchDirs(): string[] {
    const dirs = new Set<string>()

    for (const pattern of this.config.patterns) {
      // Extract the first static segment before any glob chars (* ? { [)
      const parts = pattern.split('/')
      let staticPrefix = ''
      for (const part of parts) {
        if (/[*?{[]/.test(part)) break
        staticPrefix = staticPrefix ? `${staticPrefix}/${part}` : part
      }

      const dir = staticPrefix
        ? path.join(this.rootDir, staticPrefix)
        : this.rootDir

      if (fs.existsSync(dir)) {
        dirs.add(dir)
      }
    }

    // Fallback: if no valid directories found, watch root
    if (dirs.size === 0) {
      dirs.add(this.rootDir)
    }

    return [...dirs]
  }
}

// ---------------------------------------------------------------------------
// LintTestRunner
// ---------------------------------------------------------------------------

export class LintTestRunner {
  private cwd: string

  constructor(cwd: string) {
    this.cwd = path.resolve(cwd)
  }

  /** Execute the configured lint command and parse output. */
  runLint(config: WatchConfig): RunResult {
    if (!config.lintCommand) {
      return { success: true, output: '', errors: [] }
    }
    return this.exec(config.lintCommand)
  }

  /** Execute the configured test command and parse output. */
  runTests(config: WatchConfig): RunResult {
    if (!config.testCommand) {
      return { success: true, output: '', errors: [] }
    }
    return this.exec(config.testCommand)
  }

  /** Run an arbitrary command, capture output, parse errors. */
  private exec(command: string): RunResult {
    let stdout = ''
    let success = false

    try {
      stdout = execSync(command, {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000, // 2 minute timeout
      })
      success = true
    } catch (err: any) {
      // execSync throws on non-zero exit codes
      stdout = (err.stdout ?? '') + '\n' + (err.stderr ?? '')
      success = false
    }

    const errors = this.parseErrors(stdout)
    return { success, output: stdout.trim(), errors }
  }

  /** Parse common error formats from combined stdout/stderr output. */
  private parseErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = []
    const lines = output.split('\n')

    for (const line of lines) {
      const parsed = this.parseESLintLine(line)
        ?? this.parseTypeScriptLine(line)
        ?? this.parseJestLine(line)
        ?? this.parseGenericLine(line)

      if (parsed) {
        errors.push(parsed)
      }
    }

    return errors
  }

  /**
   * ESLint format:
   *   /path/to/file.ts:10:5: error Some message (rule-name)
   *   /path/to/file.ts:10:5: warning Some message (rule-name)
   *
   * Also matches the short form:
   *   file.ts(10,5): error TS1234: message
   */
  private parseESLintLine(line: string): ParsedError | null {
    // Standard ESLint: /path:line:col: severity message
    const eslintMatch = line.match(
      /^(.+):(\d+):\d+:\s+(error|warning)\s+(.+)$/,
    )
    if (eslintMatch) {
      return {
        file: eslintMatch[1]!.trim(),
        line: parseInt(eslintMatch[2]!, 10),
        severity: eslintMatch[3] as 'error' | 'warning',
        message: eslintMatch[4]!.trim(),
      }
    }
    return null
  }

  /**
   * TypeScript format:
   *   file.ts(10,5): error TS1234: Some message
   *   file.ts:10:5 - error TS1234: Some message
   */
  private parseTypeScriptLine(line: string): ParsedError | null {
    // TS parenthesized format: file.ts(10,5): error TS1234: message
    const tsParenMatch = line.match(
      /^(.+)\((\d+),\d+\):\s+(error|warning)\s+(.+)$/,
    )
    if (tsParenMatch) {
      return {
        file: tsParenMatch[1]!.trim(),
        line: parseInt(tsParenMatch[2]!, 10),
        severity: tsParenMatch[3] as 'error' | 'warning',
        message: tsParenMatch[4]!.trim(),
      }
    }

    // TS dash format: file.ts:10:5 - error TS1234: message
    const tsDashMatch = line.match(
      /^(.+):(\d+):\d+\s+-\s+(error|warning)\s+(.+)$/,
    )
    if (tsDashMatch) {
      return {
        file: tsDashMatch[1]!.trim(),
        line: parseInt(tsDashMatch[2]!, 10),
        severity: tsDashMatch[3] as 'error' | 'warning',
        message: tsDashMatch[4]!.trim(),
      }
    }

    return null
  }

  /**
   * Jest format:
   *   FAIL src/foo.test.ts
   *     ● Test suite name > test name
   *
   * We look for lines like:
   *   at Object.<anonymous> (src/foo.test.ts:10:5)
   */
  private parseJestLine(line: string): ParsedError | null {
    // Jest stack trace: at ... (file:line:col)
    const jestMatch = line.match(
      /at\s+.+\((.+):(\d+):\d+\)/,
    )
    if (jestMatch) {
      return {
        file: jestMatch[1]!.trim(),
        line: parseInt(jestMatch[2]!, 10),
        severity: 'error',
        message: line.trim(),
      }
    }

    return null
  }

  /**
   * Generic fallback: file:line: message (with error/warning keyword somewhere).
   */
  private parseGenericLine(line: string): ParsedError | null {
    const genericMatch = line.match(
      /^(.+):(\d+):\s*(.+)$/,
    )
    if (genericMatch) {
      const msg = genericMatch[3]!.trim()
      // Only capture if it looks like an error/warning
      if (/\b(error|Error|ERROR)\b/.test(msg)) {
        return {
          file: genericMatch[1]!.trim(),
          line: parseInt(genericMatch[2]!, 10),
          severity: 'error',
          message: msg,
        }
      }
      if (/\b(warning|Warning|WARN)\b/.test(msg)) {
        return {
          file: genericMatch[1]!.trim(),
          line: parseInt(genericMatch[2]!, 10),
          severity: 'warning',
          message: msg,
        }
      }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// WatchModeManager
// ---------------------------------------------------------------------------

export type ErrorsFoundCallback = (errors: ParsedError[], source: 'lint' | 'test') => void

export class WatchModeManager {
  private watcher: FileWatcher | null = null
  private runner: LintTestRunner
  private config: WatchConfig
  private rootDir: string
  private _watching = false
  private _filesWatched = 0
  private _lastChange: Date | null = null
  private _errorCount = 0
  private _onErrorsFound: ErrorsFoundCallback[] = []

  constructor(rootDir: string, config?: Partial<WatchConfig>) {
    this.rootDir = path.resolve(rootDir)
    this.config = createDefaultConfig(config)
    this.runner = new LintTestRunner(this.rootDir)
  }

  /** Register a callback for when lint/test errors are found. */
  onErrorsFound(cb: ErrorsFoundCallback): void {
    this._onErrorsFound.push(cb)
  }

  /** Start the watch mode loop. */
  start(config?: Partial<WatchConfig>): void {
    if (this._watching) return

    if (config) {
      this.config = createDefaultConfig({ ...this.config, ...config })
    }

    this.watcher = new FileWatcher(this.rootDir, this.config)

    this.watcher.onChange((files) => {
      this._lastChange = new Date()
      this._filesWatched += files.length
      this.handleChanges(files)
    })

    this.watcher.onError((err) => {
      // Silently track — callers can listen via onErrorsFound for structured data
      this._errorCount++
      console.error(`[watch] Watcher error: ${err.message}`)
    })

    this.watcher.start()
    this._watching = true
  }

  /** Stop watching. */
  stop(): void {
    if (this.watcher) {
      this.watcher.stop()
      this.watcher = null
    }
    this._watching = false
  }

  /** Get current watch status. */
  getStatus(): WatchStatus {
    return {
      watching: this._watching,
      filesWatched: this._filesWatched,
      lastChange: this._lastChange,
      errorCount: this._errorCount,
    }
  }

  /** Get the current config. */
  getConfig(): WatchConfig {
    return { ...this.config }
  }

  /** Update config (restarts watcher if running). */
  updateConfig(partial: Partial<WatchConfig>): void {
    const wasWatching = this._watching
    if (wasWatching) this.stop()
    this.config = createDefaultConfig({ ...this.config, ...partial })
    if (wasWatching) this.start()
  }

  /**
   * Scan the given files for AI trigger comments.
   * Returns all comments matching the configured triggerComment pattern.
   */
  scanForAIComments(files: string[]): AIComment[] {
    const comments: AIComment[] = []
    const trigger = this.config.triggerComment

    for (const relFile of files) {
      const absPath = path.isAbsolute(relFile)
        ? relFile
        : path.join(this.rootDir, relFile)

      let content: string
      try {
        content = fs.readFileSync(absPath, 'utf-8')
      } catch {
        continue
      }

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        // Match // AI: ..., # AI: ..., /* AI: ... */
        const match = line.match(
          new RegExp(`(?://|#|/\\*)\\s*${escapeRegExp(trigger)}\\s*(.+?)(?:\\s*\\*/)?$`),
        )
        if (match) {
          comments.push({
            file: relFile,
            line: i + 1,
            comment: match[1]!.trim(),
          })
        }
      }
    }

    return comments
  }

  /** Manually trigger a lint+test run and return results. */
  runChecks(): { lint: RunResult; test: RunResult } {
    const lint = this.runner.runLint(this.config)
    const test = this.runner.runTests(this.config)
    return { lint, test }
  }

  // -- private --

  private handleChanges(files: string[]): void {
    // 1. Run lint
    const lintResult = this.runner.runLint(this.config)
    if (!lintResult.success && lintResult.errors.length > 0) {
      this._errorCount += lintResult.errors.length
      for (const cb of this._onErrorsFound) {
        cb(lintResult.errors, 'lint')
      }
    }

    // 2. Run tests (always, but especially if lint found errors)
    const testResult = this.runner.runTests(this.config)
    if (!testResult.success && testResult.errors.length > 0) {
      this._errorCount += testResult.errors.length
      for (const cb of this._onErrorsFound) {
        cb(testResult.errors, 'test')
      }
    }

    // 3. Scan for AI comments if autoFix is on
    if (this.config.autoFix) {
      const _aiComments = this.scanForAIComments(files)
      // AI comments are available for callers to consume via scanForAIComments()
      // The autoFix integration hook would process these externally.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
