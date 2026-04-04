import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'

export interface Checkpoint {
  id: string // short hash
  timestamp: number
  description: string // what tool triggered it
  files: string[] // files that were modified
  stashRef?: string // git stash reference
}

interface CheckpointManifest {
  projectHash: string
  checkpoints: Checkpoint[]
}

export class CheckpointManager {
  readonly storePath: string
  private readonly cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
    const projectHash = this.getProjectHash()
    const configHome =
      process.env.VOID_CONFIG_DIR ??
      process.env.CLAUDE_CONFIG_DIR ??
      join(homedir(), '.void')
    this.storePath = join(configHome, 'checkpoints', projectHash)
  }

  /**
   * Creates a checkpoint before file modifications.
   * Uses `git stash create` to capture the current working state without
   * modifying the working tree or index.
   */
  create(description: string, files: string[]): Checkpoint {
    const stashRef = this.gitStashCreate()
    const id = createHash('sha256')
      .update(`${Date.now()}-${description}-${files.join(',')}`)
      .digest('hex')
      .slice(0, 12)

    const checkpoint: Checkpoint = {
      id,
      timestamp: Date.now(),
      description,
      files,
      stashRef: stashRef || undefined,
    }

    const manifest = this.loadManifest()
    manifest.checkpoints.push(checkpoint)
    this.saveManifest(manifest)

    return checkpoint
  }

  /**
   * Returns all checkpoints for the current project, sorted by timestamp
   * (oldest first).
   */
  list(): Checkpoint[] {
    const manifest = this.loadManifest()
    return manifest.checkpoints.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Shows what changed at a given checkpoint by running
   * `git stash show -p <stashRef>`.
   * Returns the diff output as a string, or a message if no stash ref exists.
   */
  diff(checkpointId: string): string {
    const checkpoint = this.findCheckpoint(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint "${checkpointId}" not found`)
    }
    if (!checkpoint.stashRef) {
      return `Checkpoint "${checkpointId}" has no git stash reference (working tree was clean when it was created).`
    }
    try {
      return execSync(`git stash show -p ${checkpoint.stashRef}`, {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch (err) {
      throw new Error(
        `Failed to show diff for checkpoint "${checkpointId}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * Restores the workspace to the state captured in a checkpoint
   * using `git stash apply <stashRef>`.
   */
  restore(checkpointId: string): void {
    const checkpoint = this.findCheckpoint(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint "${checkpointId}" not found`)
    }
    if (!checkpoint.stashRef) {
      throw new Error(
        `Checkpoint "${checkpointId}" has no git stash reference and cannot be restored.`,
      )
    }
    try {
      execSync(`git stash apply ${checkpoint.stashRef}`, {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      throw new Error(
        `Failed to restore checkpoint "${checkpointId}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * Remove old checkpoints beyond keepCount, keeping the most recent ones.
   */
  prune(keepCount: number = 50): number {
    const manifest = this.loadManifest()
    const sorted = manifest.checkpoints.sort(
      (a, b) => a.timestamp - b.timestamp,
    )
    if (sorted.length <= keepCount) {
      return 0
    }
    const removeCount = sorted.length - keepCount
    manifest.checkpoints = sorted.slice(removeCount)
    this.saveManifest(manifest)
    return removeCount
  }

  /**
   * Creates a deterministic hash from the git remote URL or cwd path.
   * This identifies the project so checkpoints are stored per-project.
   */
  getProjectHash(): string {
    let identifier: string
    try {
      identifier = execSync('git remote get-url origin', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      // No git remote — fall back to the working directory path
      identifier = this.cwd
    }
    return createHash('sha256').update(identifier).digest('hex').slice(0, 16)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findCheckpoint(checkpointId: string): Checkpoint | undefined {
    const manifest = this.loadManifest()
    return manifest.checkpoints.find(cp => cp.id === checkpointId)
  }

  private get manifestPath(): string {
    return join(this.storePath, 'manifest.json')
  }

  private loadManifest(): CheckpointManifest {
    try {
      if (existsSync(this.manifestPath)) {
        const raw = readFileSync(this.manifestPath, 'utf-8')
        return JSON.parse(raw) as CheckpointManifest
      }
    } catch {
      // Corrupted manifest — start fresh
    }
    return {
      projectHash: this.getProjectHash(),
      checkpoints: [],
    }
  }

  private saveManifest(manifest: CheckpointManifest): void {
    mkdirSync(this.storePath, { recursive: true })
    writeFileSync(
      this.manifestPath,
      JSON.stringify(manifest, null, 2),
      'utf-8',
    )
  }

  /**
   * Runs `git stash create` which builds a stash commit from the current
   * working tree state without modifying the index or working tree.
   * Returns the stash commit hash, or an empty string if the tree is clean.
   */
  private gitStashCreate(): string {
    try {
      const result = execSync('git stash create', {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
      return result
    } catch {
      // Not a git repo or git not available — return empty
      return ''
    }
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

let _instance: CheckpointManager | null = null

/**
 * Returns a singleton CheckpointManager for the current working directory.
 */
export function getCheckpointManager(cwd?: string): CheckpointManager {
  const resolvedCwd = cwd ?? process.cwd()
  if (!_instance || _instance['cwd'] !== resolvedCwd) {
    _instance = new CheckpointManager(resolvedCwd)
  }
  return _instance
}

/**
 * Convenience wrapper: creates a checkpoint before editing files.
 * Intended to be called by file-editing tools before they make changes.
 */
export function createCheckpointBeforeEdit(
  filePaths: string[],
  toolName: string,
): Checkpoint {
  const manager = getCheckpointManager()
  return manager.create(`${toolName}: ${filePaths.join(', ')}`, filePaths)
}
