/**
 * Frecency store — persistent tracking of file-access recency and frequency.
 *
 * Uses a Mozilla-inspired frecency formula:
 *     score = count * (1 / (1 + log2(hoursSinceLastAccess + 1)))
 *
 * Files recently and frequently accessed bubble up. Decay is logarithmic so
 * something accessed 10x a month ago still ranks above something accessed
 * once 20 min ago.
 *
 * Storage: ~/.void/frecency.json (or $VOID_CONFIG_DIR/frecency.json).
 * Writes are debounced via a dirty flag + flush timer so hot loops (e.g.
 * agent loops reading the same file 20 times) don't thrash the disk.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrecencyEntry {
  /** Absolute path — keys are always absolute so cwd changes don't duplicate. */
  path: string
  /** Total access count since entry was created. */
  count: number
  /** Epoch millis of last access. */
  lastAccess: number
}

interface FrecencyFileFormat {
  version: 1
  entries: FrecencyEntry[]
}

export interface FrecencyStoreOptions {
  /** Override storage path (primarily for tests). */
  filePath?: string
  /** Cap on total entries; oldest entries are evicted first. Default 1000. */
  maxEntries?: number
  /** Milliseconds to wait before flushing a dirty store. Default 500. */
  flushDelayMs?: number
  /** If true, never write to disk (for tests). */
  memoryOnly?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 1000
const DEFAULT_FLUSH_DELAY = 500
const MS_PER_HOUR = 3_600_000

// ---------------------------------------------------------------------------
// Pure scoring functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Mozilla-style frecency: count * 1 / (1 + log2(hours + 1)).
 * +1 inside log so an access in the last hour has log2(1..2) ∈ [0,1].
 *
 * Examples (count = 1):
 *   hoursSince = 0    → score ≈ 1.0
 *   hoursSince = 1    → score ≈ 1.0
 *   hoursSince = 24   → score ≈ 0.178
 *   hoursSince = 168  → score ≈ 0.135 (one week)
 *   hoursSince = 720  → score ≈ 0.099 (one month)
 */
export function calculateFrecency(entry: {
  count: number
  lastAccess: number
}, nowMs: number = Date.now()): number {
  if (entry.count <= 0) return 0
  const hoursSince = Math.max(0, (nowMs - entry.lastAccess) / MS_PER_HOUR)
  const denom = 1 + Math.log2(hoursSince + 1)
  return entry.count / denom
}

// ---------------------------------------------------------------------------
// Default storage path
// ---------------------------------------------------------------------------

function getDefaultStorePath(): string {
  const configDir =
    process.env.VOID_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(homedir(), '.void')
  return path.join(configDir, 'frecency.json')
}

// ---------------------------------------------------------------------------
// FrecencyStore
// ---------------------------------------------------------------------------

export class FrecencyStore {
  private readonly filePath: string
  private readonly maxEntries: number
  private readonly flushDelayMs: number
  private readonly memoryOnly: boolean

  private entries: Map<string, FrecencyEntry> = new Map()
  private loaded = false
  private dirty = false
  private flushTimer: NodeJS.Timeout | null = null

  constructor(options: FrecencyStoreOptions = {}) {
    this.filePath = options.filePath ?? getDefaultStorePath()
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY
    this.memoryOnly = options.memoryOnly ?? false
  }

  /**
   * Load entries from disk. Safe to call multiple times (no-op after load).
   * Corrupt or missing files start fresh — never throws.
   */
  load(): void {
    if (this.loaded) return
    this.loaded = true

    if (this.memoryOnly) return

    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<FrecencyFileFormat>
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
      for (const e of entries) {
        if (
          e &&
          typeof e.path === 'string' &&
          typeof e.count === 'number' &&
          typeof e.lastAccess === 'number'
        ) {
          this.entries.set(e.path, { path: e.path, count: e.count, lastAccess: e.lastAccess })
        }
      }
    } catch {
      // Corrupt file — wipe and start fresh. Keeping bad data would keep
      // the store permanently broken.
      this.entries.clear()
    }
  }

  /**
   * Record an access to a path. Path is normalized to absolute form.
   * Schedules a debounced flush.
   */
  bump(filePath: string, nowMs: number = Date.now()): void {
    if (!filePath) return
    this.load()
    const abs = path.resolve(filePath)
    const existing = this.entries.get(abs)
    if (existing) {
      existing.count += 1
      existing.lastAccess = nowMs
    } else {
      this.entries.set(abs, { path: abs, count: 1, lastAccess: nowMs })
      if (this.entries.size > this.maxEntries) {
        this.evictOldest()
      }
    }
    this.markDirty()
  }

  /**
   * Frecency score for a path. Returns 0 if unknown.
   * Accepts absolute or relative (relative → resolved against cwd).
   */
  score(filePath: string, nowMs: number = Date.now()): number {
    this.load()
    const abs = path.resolve(filePath)
    const entry = this.entries.get(abs)
    if (!entry) return 0
    return calculateFrecency(entry, nowMs)
  }

  /**
   * Get all entries ordered by frecency score descending.
   * Used by autocomplete to surface "recent files" when query is empty.
   */
  topByFrecency(limit: number = 20, nowMs: number = Date.now()): FrecencyEntry[] {
    this.load()
    const arr = Array.from(this.entries.values())
    arr.sort((a, b) => calculateFrecency(b, nowMs) - calculateFrecency(a, nowMs))
    return arr.slice(0, limit)
  }

  /**
   * Drop an entry — e.g. when a file is deleted. Not currently auto-invoked;
   * stale entries get outranked by active ones and eventually evicted.
   */
  remove(filePath: string): void {
    this.load()
    const abs = path.resolve(filePath)
    if (this.entries.delete(abs)) this.markDirty()
  }

  /** Clear everything. For tests + `/clear caches`. */
  clear(): void {
    this.entries.clear()
    this.markDirty()
  }

  /** Total entries currently tracked. */
  size(): number {
    this.load()
    return this.entries.size
  }

  /**
   * Force an immediate synchronous write. Called from the debounce timer or
   * explicitly at shutdown. Swallows errors — frecency is best-effort.
   */
  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.memoryOnly) return

    try {
      const dir = path.dirname(this.filePath)
      fs.mkdirSync(dir, { recursive: true })
      const payload: FrecencyFileFormat = {
        version: 1,
        entries: Array.from(this.entries.values()),
      }
      // Write to temp then rename for atomicity so an interrupted write
      // doesn't corrupt the file.
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8')
      fs.renameSync(tmp, this.filePath)
    } catch {
      // Best-effort — next bump will retry.
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private markDirty(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, this.flushDelayMs)
    // Don't prevent process exit solely for a frecency flush.
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref()
  }

  private evictOldest(): void {
    // Remove the lowest-frecency entry. Scan once, O(n); cheap at n=1000.
    const now = Date.now()
    let worstKey: string | null = null
    let worstScore = Infinity
    for (const [k, v] of this.entries) {
      const s = calculateFrecency(v, now)
      if (s < worstScore) {
        worstScore = s
        worstKey = k
      }
    }
    if (worstKey !== null) this.entries.delete(worstKey)
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: FrecencyStore | null = null

export function getFrecencyStore(): FrecencyStore {
  if (!instance) {
    instance = new FrecencyStore()
    instance.load()
  }
  return instance
}

/** For tests only — swap the singleton. */
export function __setFrecencyStoreForTest(store: FrecencyStore | null): void {
  instance = store
}
