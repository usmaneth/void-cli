/**
 * Workspace checkpointing and rollback.
 *
 * Stores file-content snapshots in ~/.void/checkpoints/ so that the workspace
 * can be restored to any previous state without polluting git history.
 */

import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Checkpoint {
  id: string
  description: string
  timestamp: string
  files: string[]
  hash: string
}

export interface RestoreResult {
  success: boolean
  filesRestored: number
  message: string
}

interface CheckpointMeta {
  checkpoints: Checkpoint[]
}

/** Contents snapshot stored per checkpoint: { relativePath: fileContent } */
type FileSnapshot = Record<string, string>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHECKPOINTS = 50

// ---------------------------------------------------------------------------
// CheckpointManager
// ---------------------------------------------------------------------------

export class CheckpointManager {
  private readonly storePath: string
  private readonly cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
    const configHome =
      process.env.VOID_CONFIG_DIR ??
      process.env.CLAUDE_CONFIG_DIR ??
      join(homedir(), '.void')
    const projectHash = this.projectHash()
    this.storePath = join(configHome, 'checkpoints', projectHash)
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create a checkpoint by snapshotting the current contents of the given
   * files (or all tracked + modified files when `files` is omitted).
   */
  create(description: string, files?: string[]): Checkpoint {
    const resolvedFiles = files ?? this.trackedAndModifiedFiles()
    const snapshot = this.readFiles(resolvedFiles)

    const id = randomUUID().replace(/-/g, '').slice(0, 12)
    const timestamp = new Date().toISOString()
    const hash = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
      .slice(0, 16)

    const checkpoint: Checkpoint = {
      id,
      description,
      timestamp,
      files: resolvedFiles,
      hash,
    }

    // Persist snapshot
    mkdirSync(this.storePath, { recursive: true })
    writeFileSync(
      this.snapshotPath(id),
      JSON.stringify(snapshot),
      'utf-8',
    )

    // Update metadata
    const meta = this.loadMeta()
    meta.checkpoints.push(checkpoint)
    this.saveMeta(meta)

    // Auto-prune
    this.prune(DEFAULT_MAX_CHECKPOINTS)

    return checkpoint
  }

  /**
   * List all checkpoints, newest first.
   */
  list(): Checkpoint[] {
    const meta = this.loadMeta()
    return [...meta.checkpoints].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
  }

  /**
   * Restore the workspace to a given checkpoint.
   */
  restore(id: string): RestoreResult {
    const checkpoint = this.getCheckpoint(id)
    if (!checkpoint) {
      return { success: false, filesRestored: 0, message: `Checkpoint "${id}" not found.` }
    }

    const snapshotFile = this.snapshotPath(id)
    if (!existsSync(snapshotFile)) {
      return { success: false, filesRestored: 0, message: `Snapshot data for "${id}" is missing.` }
    }

    let snapshot: FileSnapshot
    try {
      snapshot = JSON.parse(readFileSync(snapshotFile, 'utf-8')) as FileSnapshot
    } catch {
      return { success: false, filesRestored: 0, message: `Failed to parse snapshot for "${id}".` }
    }

    let filesRestored = 0
    const errors: string[] = []

    for (const [relPath, content] of Object.entries(snapshot)) {
      const absPath = join(this.cwd, relPath)
      try {
        const dir = join(absPath, '..')
        mkdirSync(dir, { recursive: true })
        writeFileSync(absPath, content, 'utf-8')
        filesRestored++
      } catch (err) {
        errors.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        filesRestored,
        message: `Restored ${filesRestored} file(s) with ${errors.length} error(s):\n${errors.join('\n')}`,
      }
    }

    return {
      success: true,
      filesRestored,
      message: `Restored ${filesRestored} file(s) from checkpoint "${id}".`,
    }
  }

  /**
   * Shortcut: restore to the most recent checkpoint.
   */
  undo(): RestoreResult {
    const all = this.list()
    if (all.length === 0) {
      return { success: false, filesRestored: 0, message: 'No checkpoints available to undo.' }
    }
    return this.restore(all[0]!.id)
  }

  /**
   * Show a unified diff between a checkpoint's snapshot and the current
   * working tree for each file in the checkpoint.
   */
  diff(id: string): string {
    const checkpoint = this.getCheckpoint(id)
    if (!checkpoint) {
      return `Checkpoint "${id}" not found.`
    }

    const snapshotFile = this.snapshotPath(id)
    if (!existsSync(snapshotFile)) {
      return `Snapshot data for "${id}" is missing.`
    }

    let snapshot: FileSnapshot
    try {
      snapshot = JSON.parse(readFileSync(snapshotFile, 'utf-8')) as FileSnapshot
    } catch {
      return `Failed to parse snapshot for "${id}".`
    }

    const diffs: string[] = []

    for (const [relPath, savedContent] of Object.entries(snapshot)) {
      const absPath = join(this.cwd, relPath)
      let currentContent: string
      try {
        currentContent = readFileSync(absPath, 'utf-8')
      } catch {
        currentContent = ''
      }

      if (savedContent === currentContent) {
        continue
      }

      // Simple line-based diff summary
      const savedLines = savedContent.split('\n')
      const currentLines = currentContent.split('\n')
      diffs.push(
        `--- a/${relPath} (checkpoint ${id})`,
        `+++ b/${relPath} (current)`,
        `@@ saved: ${savedLines.length} lines, current: ${currentLines.length} lines @@`,
      )

      // Try git diff for a proper unified diff
      try {
        const result = execSync(
          `git diff --no-index -- /dev/stdin /dev/stdin`,
          {
            input: savedContent + '\n',
            cwd: this.cwd,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
        diffs.push(result)
      } catch {
        // Fallback: show changed line count
        const added = currentLines.filter(l => !savedLines.includes(l)).length
        const removed = savedLines.filter(l => !currentLines.includes(l)).length
        diffs.push(`  +${added} -${removed} lines changed`)
      }
      diffs.push('')
    }

    if (diffs.length === 0) {
      return 'No differences between checkpoint and current state.'
    }

    return diffs.join('\n')
  }

  /**
   * Retrieve a single checkpoint by id, or null if not found.
   */
  getCheckpoint(id: string): Checkpoint | null {
    const meta = this.loadMeta()
    return meta.checkpoints.find(cp => cp.id === id) ?? null
  }

  /**
   * Remove old checkpoints beyond `maxCount`, keeping the newest.
   * Returns the number of checkpoints removed.
   */
  prune(maxCount: number = DEFAULT_MAX_CHECKPOINTS): number {
    const meta = this.loadMeta()
    if (meta.checkpoints.length <= maxCount) {
      return 0
    }

    // Sort newest first, then slice off extras
    const sorted = [...meta.checkpoints].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    const keep = sorted.slice(0, maxCount)
    const removed = sorted.slice(maxCount)

    // Delete snapshot files for removed checkpoints
    for (const cp of removed) {
      const path = this.snapshotPath(cp.id)
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        // Best-effort cleanup
      }
    }

    meta.checkpoints = keep
    this.saveMeta(meta)
    return removed.length
  }

  /**
   * Remove all checkpoints. Returns the number removed.
   */
  clearAll(): number {
    const meta = this.loadMeta()
    const count = meta.checkpoints.length

    // Delete all snapshot files
    for (const cp of meta.checkpoints) {
      const path = this.snapshotPath(cp.id)
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        // Best-effort cleanup
      }
    }

    meta.checkpoints = []
    this.saveMeta(meta)
    return count
  }

  /**
   * Return summary statistics about stored checkpoints.
   */
  getStats(): { total: number; oldestAge: number; newestAge: number } {
    const meta = this.loadMeta()
    if (meta.checkpoints.length === 0) {
      return { total: 0, oldestAge: 0, newestAge: 0 }
    }

    const now = Date.now()
    const timestamps = meta.checkpoints.map(cp => new Date(cp.timestamp).getTime())
    const oldest = Math.min(...timestamps)
    const newest = Math.max(...timestamps)

    return {
      total: meta.checkpoints.length,
      oldestAge: now - oldest,
      newestAge: now - newest,
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private projectHash(): string {
    let identifier: string
    try {
      identifier = execSync('git remote get-url origin', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      identifier = this.cwd
    }
    return createHash('sha256').update(identifier).digest('hex').slice(0, 16)
  }

  private get metaPath(): string {
    return join(this.storePath, 'checkpoints.json')
  }

  private snapshotPath(id: string): string {
    return join(this.storePath, `${id}.json`)
  }

  private loadMeta(): CheckpointMeta {
    try {
      if (existsSync(this.metaPath)) {
        return JSON.parse(readFileSync(this.metaPath, 'utf-8')) as CheckpointMeta
      }
    } catch {
      // Corrupted — start fresh
    }
    return { checkpoints: [] }
  }

  private saveMeta(meta: CheckpointMeta): void {
    mkdirSync(this.storePath, { recursive: true })
    writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf-8')
  }

  /**
   * Return relative paths for all tracked and modified files in the repo.
   */
  private trackedAndModifiedFiles(): string[] {
    try {
      const tracked = execSync('git ls-files', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
        .trim()
        .split('\n')
        .filter(Boolean)

      const modified = execSync('git diff --name-only', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
        .trim()
        .split('\n')
        .filter(Boolean)

      const untracked = execSync('git ls-files --others --exclude-standard', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
        .trim()
        .split('\n')
        .filter(Boolean)

      const all = new Set([...tracked, ...modified, ...untracked])
      return [...all]
    } catch {
      return []
    }
  }

  /**
   * Read file contents for the given relative paths, returning a snapshot map.
   */
  private readFiles(relativePaths: string[]): FileSnapshot {
    const snapshot: FileSnapshot = {}
    for (const relPath of relativePaths) {
      const absPath = join(this.cwd, relPath)
      try {
        snapshot[relPath] = readFileSync(absPath, 'utf-8')
      } catch {
        // File may have been deleted — skip
      }
    }
    return snapshot
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: CheckpointManager | null = null

/**
 * Returns a singleton CheckpointManager for the given (or current) working
 * directory.
 */
export function getCheckpointManager(cwd?: string): CheckpointManager {
  const resolvedCwd = cwd ?? process.cwd()
  if (!_instance || ((_instance as any).cwd as string) !== resolvedCwd) {
    _instance = new CheckpointManager(resolvedCwd)
  }
  return _instance
}
