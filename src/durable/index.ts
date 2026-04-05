import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DurableStepStatus = 'pending' | 'completed' | 'failed'

export interface DurableStep {
  id: number
  description: string
  toolName?: string
  toolArgs?: any
  result?: any
  status: DurableStepStatus
  completedAt?: string
}

export type ExecutionStatus = 'running' | 'interrupted' | 'completed'

export interface ExecutionState {
  id: string
  taskDescription: string
  steps: DurableStep[]
  currentStep: number
  context: Record<string, any>
  startedAt: string
  lastCheckpoint: string
  status: ExecutionStatus
}

export interface ExecutionManifestEntry {
  id: string
  taskDescription: string
  status: ExecutionStatus
  startedAt: string
  lastCheckpoint: string
  stepsTotal: number
  stepsCompleted: number
}

export interface ExecutionListFilter {
  status?: ExecutionStatus
}

export interface ExecutionStats {
  total: number
  running: number
  interrupted: number
  completed: number
  oldestExecution: string | null
  newestExecution: string | null
}

// ---------------------------------------------------------------------------
// DurableExecutionManager
// ---------------------------------------------------------------------------

const DURABLE_DIR_NAME = 'durable'
const MANIFEST_FILE = 'executions.json'
const AUTO_CHECKPOINT_INTERVAL_MS = 30_000
const DEFAULT_CLEANUP_DAYS = 7

export class DurableExecutionManager {
  private readonly baseDir: string
  private executions: Map<string, ExecutionState> = new Map()
  private manifest: ExecutionManifestEntry[] = []
  private checkpointTimer: ReturnType<typeof setInterval> | null = null
  private signalHandlersInstalled = false
  private boundSigintHandler: (() => void) | null = null
  private boundSigtermHandler: (() => void) | null = null

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ?? path.join(os.homedir(), '.void', DURABLE_DIR_NAME)
    this.ensureDir()
    this.loadManifest()
    this.markRunningAsInterrupted()
    this.startAutoCheckpoint()
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a new durable execution and return its id.
   */
  startExecution(description: string): string {
    const id = crypto.randomUUID().slice(0, 8)
    const now = new Date().toISOString()
    const state: ExecutionState = {
      id,
      taskDescription: description,
      steps: [],
      currentStep: 0,
      context: {},
      startedAt: now,
      lastCheckpoint: now,
      status: 'running',
    }
    this.executions.set(id, state)
    this.updateManifestEntry(state)
    this.persistState(id)
    this.persistManifest()
    return id
  }

  /**
   * Save current state of an execution to disk.
   */
  checkpoint(id: string): void {
    const state = this.requireExecution(id)
    state.lastCheckpoint = new Date().toISOString()
    this.persistState(id)
    this.updateManifestEntry(state)
    this.persistManifest()
  }

  /**
   * Add a step to an execution.
   */
  addStep(
    id: string,
    step: Omit<DurableStep, 'id' | 'status'>,
  ): DurableStep {
    const state = this.requireExecution(id)
    const newStep: DurableStep = {
      ...step,
      id: state.steps.length,
      status: 'pending',
    }
    state.steps.push(newStep)
    return newStep
  }

  /**
   * Mark a step as completed with its result.
   */
  completeStep(id: string, stepId: number, result: any): void {
    const state = this.requireExecution(id)
    const step = this.requireStep(state, stepId)
    step.status = 'completed'
    step.result = result
    step.completedAt = new Date().toISOString()
    state.currentStep = stepId + 1
  }

  /**
   * Mark a step as failed with an error.
   */
  failStep(id: string, stepId: number, error: any): void {
    const state = this.requireExecution(id)
    const step = this.requireStep(state, stepId)
    step.status = 'failed'
    step.result = error instanceof Error ? error.message : String(error)
    step.completedAt = new Date().toISOString()
    state.status = 'interrupted'
    this.checkpoint(id)
  }

  /**
   * Get execution state by id.
   */
  getExecution(id: string): ExecutionState | undefined {
    // Try in-memory first, then disk
    if (this.executions.has(id)) {
      return this.executions.get(id)
    }
    return this.loadExecutionFromDisk(id)
  }

  /**
   * List all executions, optionally filtered by status.
   */
  listExecutions(filter?: ExecutionListFilter): ExecutionManifestEntry[] {
    if (!filter || !filter.status) {
      return [...this.manifest]
    }
    return this.manifest.filter((e) => e.status === filter.status)
  }

  /**
   * List interrupted/incomplete executions that can be resumed.
   */
  getResumable(): ExecutionManifestEntry[] {
    return this.manifest.filter(
      (e) => e.status === 'interrupted' || e.status === 'running',
    )
  }

  /**
   * Load state for a given execution and return steps to replay from.
   * Returns the execution state with currentStep pointing at the first
   * incomplete step.
   */
  resume(id: string): {
    execution: ExecutionState
    pendingSteps: DurableStep[]
  } {
    let state = this.executions.get(id)
    if (!state) {
      const loaded = this.loadExecutionFromDisk(id)
      if (!loaded) {
        throw new Error(`Execution ${id} not found`)
      }
      state = loaded
      this.executions.set(id, state)
    }
    state.status = 'running'
    state.lastCheckpoint = new Date().toISOString()
    this.updateManifestEntry(state)
    this.persistState(id)
    this.persistManifest()

    const pendingSteps = state.steps.filter((s) => s.status === 'pending')
    return { execution: state, pendingSteps }
  }

  /**
   * Mark an execution as completed.
   */
  complete(id: string): void {
    const state = this.requireExecution(id)
    state.status = 'completed'
    state.lastCheckpoint = new Date().toISOString()
    this.updateManifestEntry(state)
    this.persistState(id)
    this.persistManifest()
  }

  /**
   * Remove old execution states.
   */
  cleanup(daysOld: number = DEFAULT_CLEANUP_DAYS): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
    const toRemove: string[] = []
    for (const entry of this.manifest) {
      const ts = new Date(entry.lastCheckpoint).getTime()
      if (ts < cutoff) {
        toRemove.push(entry.id)
      }
    }
    for (const id of toRemove) {
      this.removeExecution(id)
    }
    return toRemove.length
  }

  /**
   * Clear all execution states.
   */
  clearAll(): number {
    const count = this.manifest.length
    const ids = this.manifest.map((e) => e.id)
    for (const id of ids) {
      this.removeExecution(id)
    }
    return count
  }

  /**
   * Get stats on executions.
   */
  getStats(): ExecutionStats {
    const stats: ExecutionStats = {
      total: this.manifest.length,
      running: 0,
      interrupted: 0,
      completed: 0,
      oldestExecution: null,
      newestExecution: null,
    }
    let oldest = Infinity
    let newest = -Infinity

    for (const entry of this.manifest) {
      switch (entry.status) {
        case 'running':
          stats.running++
          break
        case 'interrupted':
          stats.interrupted++
          break
        case 'completed':
          stats.completed++
          break
      }
      const ts = new Date(entry.startedAt).getTime()
      if (ts < oldest) {
        oldest = ts
        stats.oldestExecution = entry.startedAt
      }
      if (ts > newest) {
        newest = ts
        stats.newestExecution = entry.startedAt
      }
    }
    return stats
  }

  /**
   * Register SIGINT/SIGTERM handlers to auto-checkpoint on exit.
   */
  installSignalHandlers(): void {
    if (this.signalHandlersInstalled) {
      return
    }
    this.boundSigintHandler = () => this.handleSignal()
    this.boundSigtermHandler = () => this.handleSignal()
    process.on('SIGINT', this.boundSigintHandler)
    process.on('SIGTERM', this.boundSigtermHandler)
    this.signalHandlersInstalled = true
  }

  /**
   * Unregister SIGINT/SIGTERM handlers.
   */
  removeSignalHandlers(): void {
    if (!this.signalHandlersInstalled) {
      return
    }
    if (this.boundSigintHandler) {
      process.removeListener('SIGINT', this.boundSigintHandler)
      this.boundSigintHandler = null
    }
    if (this.boundSigtermHandler) {
      process.removeListener('SIGTERM', this.boundSigtermHandler)
      this.boundSigtermHandler = null
    }
    this.signalHandlersInstalled = false
  }

  /**
   * Stop the auto-checkpoint timer.
   */
  destroy(): void {
    this.stopAutoCheckpoint()
    this.removeSignalHandlers()
  }

  // -----------------------------------------------------------------------
  // Private — file system
  // -----------------------------------------------------------------------

  private ensureDir(): void {
    fs.mkdirSync(this.baseDir, { recursive: true })
  }

  private manifestPath(): string {
    return path.join(this.baseDir, MANIFEST_FILE)
  }

  private executionPath(id: string): string {
    return path.join(this.baseDir, `${id}.json`)
  }

  private persistState(id: string): void {
    const state = this.executions.get(id)
    if (!state) {
      return
    }
    const tmpPath = this.executionPath(id) + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tmpPath, this.executionPath(id))
  }

  private persistManifest(): void {
    const tmpPath = this.manifestPath() + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(this.manifest, null, 2), 'utf-8')
    fs.renameSync(tmpPath, this.manifestPath())
  }

  private loadManifest(): void {
    const p = this.manifestPath()
    if (!fs.existsSync(p)) {
      this.manifest = []
      return
    }
    try {
      const raw = fs.readFileSync(p, 'utf-8')
      this.manifest = JSON.parse(raw) as ExecutionManifestEntry[]
    } catch {
      this.manifest = []
    }
  }

  private loadExecutionFromDisk(id: string): ExecutionState | undefined {
    const p = this.executionPath(id)
    if (!fs.existsSync(p)) {
      return undefined
    }
    try {
      const raw = fs.readFileSync(p, 'utf-8')
      const state = JSON.parse(raw) as ExecutionState
      this.executions.set(id, state)
      return state
    } catch {
      return undefined
    }
  }

  private removeExecution(id: string): void {
    this.executions.delete(id)
    this.manifest = this.manifest.filter((e) => e.id !== id)
    const p = this.executionPath(id)
    try {
      fs.unlinkSync(p)
    } catch {
      // file may not exist, that's fine
    }
    this.persistManifest()
  }

  // -----------------------------------------------------------------------
  // Private — manifest helpers
  // -----------------------------------------------------------------------

  private updateManifestEntry(state: ExecutionState): void {
    const completedCount = state.steps.filter(
      (s) => s.status === 'completed',
    ).length
    const entry: ExecutionManifestEntry = {
      id: state.id,
      taskDescription: state.taskDescription,
      status: state.status,
      startedAt: state.startedAt,
      lastCheckpoint: state.lastCheckpoint,
      stepsTotal: state.steps.length,
      stepsCompleted: completedCount,
    }
    const idx = this.manifest.findIndex((e) => e.id === state.id)
    if (idx >= 0) {
      this.manifest[idx] = entry
    } else {
      this.manifest.push(entry)
    }
  }

  /**
   * Any execution that was "running" from a previous process is now
   * "interrupted" because that process is gone.
   */
  private markRunningAsInterrupted(): void {
    let changed = false
    for (const entry of this.manifest) {
      if (entry.status === 'running') {
        entry.status = 'interrupted'
        changed = true
        // Also update the on-disk state file if it exists
        const state = this.loadExecutionFromDisk(entry.id)
        if (state) {
          state.status = 'interrupted'
          this.persistState(entry.id)
        }
      }
    }
    if (changed) {
      this.persistManifest()
    }
  }

  // -----------------------------------------------------------------------
  // Private — validation helpers
  // -----------------------------------------------------------------------

  private requireExecution(id: string): ExecutionState {
    const state = this.executions.get(id)
    if (!state) {
      throw new Error(`Execution ${id} not found`)
    }
    return state
  }

  private requireStep(state: ExecutionState, stepId: number): DurableStep {
    const step = state.steps.find((s) => s.id === stepId)
    if (!step) {
      throw new Error(
        `Step ${stepId} not found in execution ${state.id}`,
      )
    }
    return step
  }

  // -----------------------------------------------------------------------
  // Private — auto-checkpoint & signal handling
  // -----------------------------------------------------------------------

  private startAutoCheckpoint(): void {
    this.checkpointTimer = setInterval(() => {
      this.checkpointAll()
    }, AUTO_CHECKPOINT_INTERVAL_MS)
    // Don't keep the process alive just for checkpointing
    if (this.checkpointTimer.unref) {
      this.checkpointTimer.unref()
    }
  }

  private stopAutoCheckpoint(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
  }

  private checkpointAll(): void {
    for (const [id, state] of this.executions) {
      if (state.status === 'running') {
        this.checkpoint(id)
      }
    }
  }

  private handleSignal(): void {
    // Checkpoint all running executions and mark them as interrupted
    for (const [id, state] of this.executions) {
      if (state.status === 'running') {
        state.status = 'interrupted'
        this.checkpoint(id)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: DurableExecutionManager | null = null

export function getDurableExecutionManager(): DurableExecutionManager {
  if (!instance) {
    instance = new DurableExecutionManager()
  }
  return instance
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by command.ts)
// ---------------------------------------------------------------------------

/**
 * Format a relative time string like "2m ago", "1h ago", "3d ago".
 */
export function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Truncate a string to a given length, appending "..." if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str
  }
  return str.slice(0, maxLen - 3) + '...'
}
