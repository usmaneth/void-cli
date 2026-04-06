/**
 * Watch Mode — monitor project files for AI trigger comments.
 *
 * Inspired by Aider's --watch-files. Scans for `// AI!` (action) and
 * `// AI?` (question) comments across multiple comment syntaxes, then
 * queues instructions for the AI to act on.
 *
 * Uses only Node.js built-ins (fs, path, os, crypto).
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerType = 'action' | 'question'

export interface WatchTrigger {
  id: string
  type: TriggerType
  file: string
  line: number
  instruction: string
  timestamp: string
}

interface WatchConfig {
  ignorePatterns: string[]
}

interface RecentTriggerKey {
  file: string
  line: number
  seenAt: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_QUEUE_SIZE = 20
const DEBOUNCE_MS = 500
const DEDUP_WINDOW_MS = 5_000
const MAX_FILE_SIZE = 1_048_576 // 1 MB

const DEFAULT_IGNORE_PATTERNS: string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.void',
]

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flac', '.wav',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pyc', '.class', '.o', '.obj',
])

/**
 * Regex that matches AI trigger comments across languages:
 *   // AI!  or  // AI?   (JS/TS/C/Go/Rust/Java/etc.)
 *   #  AI!  or  #  AI?   (Python/Ruby/Shell/YAML)
 *   /* AI! * / or /* AI? * /   (block comments)
 *   -- AI!  or  -- AI?   (SQL/Haskell/Lua)
 *
 * Capture groups:
 *   1 = '!' or '?'
 *   2 = instruction text (rest of line)
 */
const TRIGGER_RE = /(?:\/\/|#|\/\*|--)\s*AI([!?])\s*(.*?)(?:\s*\*\/)?$/

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function configDir(): string {
  return path.join(os.homedir(), '.void')
}

function configPath(): string {
  return path.join(configDir(), 'watch.json')
}

function loadConfig(): WatchConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WatchConfig>
    return {
      ignorePatterns: Array.isArray(parsed.ignorePatterns) ? parsed.ignorePatterns : [],
    }
  } catch {
    return { ignorePatterns: [] }
  }
}

function saveConfig(config: WatchConfig): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

function loadGitignorePatterns(rootDir: string): string[] {
  const patterns: string[] = []
  try {
    const raw = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.push(trimmed)
      }
    }
  } catch {
    // No .gitignore or unreadable — that's fine
  }
  return patterns
}

// ---------------------------------------------------------------------------
// WatchModeManager
// ---------------------------------------------------------------------------

export class WatchModeManager {
  private watcher: fs.FSWatcher | null = null
  private rootDir: string = ''
  private queue: WatchTrigger[] = []
  private ignorePatterns: string[] = []
  private gitignorePatterns: string[] = []
  private recentTriggers: RecentTriggerKey[] = []
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private filesWatchedCount: number = 0
  private triggersDetected: number = 0
  private triggersProcessed: number = 0

  // -- Lifecycle ------------------------------------------------------------

  start(rootDir: string): void {
    if (this.watcher) {
      this.stop()
    }

    this.rootDir = path.resolve(rootDir)

    // Load config and gitignore
    const config = loadConfig()
    this.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...config.ignorePatterns]
    this.gitignorePatterns = loadGitignorePatterns(this.rootDir)

    // Count initially visible files (rough estimate via single readdir)
    this.filesWatchedCount = this.countFiles(this.rootDir, 3)

    this.watcher = fs.watch(this.rootDir, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const fullPath = path.join(this.rootDir, filename)
      this.handleChange(fullPath, filename)
    })

    // Suppress crash on watcher error (e.g. deleted root)
    this.watcher.on('error', () => {
      this.stop()
    })
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  isWatching(): boolean {
    return this.watcher !== null
  }

  // -- Queue ----------------------------------------------------------------

  getQueue(): WatchTrigger[] {
    return [...this.queue]
  }

  consumeNext(): WatchTrigger | null {
    const trigger = this.queue.shift() ?? null
    if (trigger) {
      this.triggersProcessed++
    }
    return trigger
  }

  clearQueue(): void {
    this.queue = []
  }

  // -- Stats ----------------------------------------------------------------

  getStats(): {
    watching: boolean
    filesWatched: number
    triggersDetected: number
    triggersProcessed: number
  } {
    return {
      watching: this.isWatching(),
      filesWatched: this.filesWatchedCount,
      triggersDetected: this.triggersDetected,
      triggersProcessed: this.triggersProcessed,
    }
  }

  // -- Ignore patterns ------------------------------------------------------

  getIgnorePatterns(): string[] {
    return [...this.ignorePatterns]
  }

  addIgnorePattern(pattern: string): void {
    if (!this.ignorePatterns.includes(pattern)) {
      this.ignorePatterns.push(pattern)

      // Persist to config
      const config = loadConfig()
      if (!config.ignorePatterns.includes(pattern)) {
        config.ignorePatterns.push(pattern)
        saveConfig(config)
      }
    }
  }

  // -- Internal -------------------------------------------------------------

  private handleChange(fullPath: string, relativePath: string): void {
    if (this.shouldIgnore(relativePath)) return

    // Debounce: wait 500ms after the last change to this file
    const existing = this.debounceTimers.get(fullPath)
    if (existing) clearTimeout(existing)

    this.debounceTimers.set(
      fullPath,
      setTimeout(() => {
        this.debounceTimers.delete(fullPath)
        this.scanFile(fullPath)
      }, DEBOUNCE_MS),
    )
  }

  private shouldIgnore(relativePath: string): boolean {
    const segments = relativePath.split(path.sep)

    // Check against default + user ignore patterns
    for (const pattern of this.ignorePatterns) {
      if (segments.some(seg => seg === pattern)) return true
      if (relativePath.includes(pattern)) return true
    }

    // Check against gitignore patterns (simple segment matching)
    for (const pattern of this.gitignorePatterns) {
      const clean = pattern.replace(/^\//, '').replace(/\/$/, '')
      if (segments.some(seg => seg === clean)) return true
      if (relativePath.includes(clean)) return true
    }

    // Skip binary files
    const ext = path.extname(relativePath).toLowerCase()
    if (BINARY_EXTENSIONS.has(ext)) return true

    return false
  }

  private scanFile(filePath: string): void {
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return
    } catch {
      return // File may have been deleted
    }

    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return
    }

    const lines = content.split('\n')
    const now = Date.now()

    // Prune old dedup entries
    this.recentTriggers = this.recentTriggers.filter(
      rt => now - rt.seenAt < DEDUP_WINDOW_MS,
    )

    for (let i = 0; i < lines.length; i++) {
      const match = TRIGGER_RE.exec(lines[i]!)
      if (!match) continue

      const marker = match[1] as '!' | '?'
      const instruction = (match[2] ?? '').trim()
      const lineNumber = i + 1

      // De-duplicate: skip if same file+line was seen within the window
      const isDuplicate = this.recentTriggers.some(
        rt => rt.file === filePath && rt.line === lineNumber && now - rt.seenAt < DEDUP_WINDOW_MS,
      )
      if (isDuplicate) continue

      this.recentTriggers.push({ file: filePath, line: lineNumber, seenAt: now })

      const trigger: WatchTrigger = {
        id: crypto.randomUUID(),
        type: marker === '!' ? 'action' : 'question',
        file: filePath,
        line: lineNumber,
        instruction,
        timestamp: new Date().toISOString(),
      }

      this.queue.push(trigger)
      this.triggersDetected++

      // Enforce max queue size — drop oldest
      while (this.queue.length > MAX_QUEUE_SIZE) {
        this.queue.shift()
      }
    }
  }

  /**
   * Rough file count by walking directories up to `maxDepth`.
   * Used solely for the stats display; not performance-critical.
   */
  private countFiles(dir: string, maxDepth: number): number {
    if (maxDepth <= 0) return 0
    let count = 0
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (this.ignorePatterns.some(p => entry.name === p)) continue
        if (entry.isFile()) {
          count++
        } else if (entry.isDirectory()) {
          count += this.countFiles(path.join(dir, entry.name), maxDepth - 1)
        }
      }
    } catch {
      // Permission denied or similar
    }
    return count
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: WatchModeManager | null = null

export function getWatchModeManager(): WatchModeManager {
  if (!_instance) _instance = new WatchModeManager()
  return _instance
}
