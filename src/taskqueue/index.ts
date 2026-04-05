/**
 * Agent Task Queue — local task queue with step-level logging and metrics.
 *
 * Uses JSON file storage under ~/.void/tasks/ with a tasks.json manifest
 * and individual <id>.json files per task for detailed step logs.
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export type StepType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'error'

export interface TaskStep {
  id: number
  type: StepType
  content: string
  toolName?: string
  toolArgs?: any
  toolResult?: any
  tokenUsage?: number
  durationMs?: number
  timestamp: string
}

export interface Task {
  id: string
  instruction: string
  status: TaskStatus
  steps: TaskStep[]
  tokenUsage: number
  startedAt?: string
  completedAt?: string
  error?: string
  output?: string
}

/** Lightweight manifest entry stored in tasks.json (no steps). */
interface TaskManifestEntry {
  id: string
  instruction: string
  status: TaskStatus
  tokenUsage: number
  startedAt?: string
  completedAt?: string
  error?: string
  output?: string
}

export interface TaskQueueStats {
  totalTasks: number
  byStatus: Record<TaskStatus, number>
  avgTokens: number
  avgDurationMs: number
  totalTokens: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function getTasksDir(): string {
  return path.join(os.homedir(), '.void', 'tasks')
}

function getManifestPath(): string {
  return path.join(getTasksDir(), 'tasks.json')
}

function getTaskFilePath(id: string): string {
  return path.join(getTasksDir(), `${id}.json`)
}

function ensureTasksDir(): void {
  const dir = getTasksDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readManifest(): TaskManifestEntry[] {
  const p = getManifestPath()
  if (!fs.existsSync(p)) {
    return []
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    return JSON.parse(raw) as TaskManifestEntry[]
  } catch {
    return []
  }
}

function writeManifest(entries: TaskManifestEntry[]): void {
  ensureTasksDir()
  fs.writeFileSync(getManifestPath(), JSON.stringify(entries, null, 2), 'utf-8')
}

function readTaskFile(id: string): Task | null {
  const p = getTaskFilePath(id)
  if (!fs.existsSync(p)) {
    return null
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    return JSON.parse(raw) as Task
  } catch {
    return null
  }
}

function writeTaskFile(task: Task): void {
  ensureTasksDir()
  fs.writeFileSync(getTaskFilePath(task.id), JSON.stringify(task, null, 2), 'utf-8')
}

function deleteTaskFile(id: string): void {
  const p = getTaskFilePath(id)
  if (fs.existsSync(p)) {
    fs.unlinkSync(p)
  }
}

function toManifestEntry(task: Task): TaskManifestEntry {
  return {
    id: task.id,
    instruction: task.instruction,
    status: task.status,
    tokenUsage: task.tokenUsage,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    error: task.error,
    output: task.output,
  }
}

function updateManifestEntry(entries: TaskManifestEntry[], task: Task): TaskManifestEntry[] {
  const entry = toManifestEntry(task)
  const idx = entries.findIndex(e => e.id === task.id)
  if (idx >= 0) {
    entries[idx] = entry
  } else {
    entries.push(entry)
  }
  return entries
}

// ---------------------------------------------------------------------------
// TaskQueueManager
// ---------------------------------------------------------------------------

export class TaskQueueManager {
  /**
   * Queue a new task. Returns the generated task id.
   */
  createTask(instruction: string): string {
    const id = generateId()
    const now = new Date().toISOString()
    const task: Task = {
      id,
      instruction,
      status: 'queued',
      steps: [],
      tokenUsage: 0,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      output: undefined,
    }

    // Persist task file
    writeTaskFile(task)

    // Update manifest
    const manifest = readManifest()
    manifest.push({
      id,
      instruction,
      status: 'queued',
      tokenUsage: 0,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      output: undefined,
    })
    writeManifest(manifest)

    return id
  }

  /**
   * Mark a task as running.
   */
  startTask(id: string): void {
    const task = readTaskFile(id)
    if (!task) {
      throw new Error(`Task not found: ${id}`)
    }
    task.status = 'running'
    task.startedAt = new Date().toISOString()
    writeTaskFile(task)

    const manifest = readManifest()
    updateManifestEntry(manifest, task)
    writeManifest(manifest)
  }

  /**
   * Add a step to a task's log.
   */
  addStep(
    taskId: string,
    step: Omit<TaskStep, 'id' | 'timestamp'>,
  ): TaskStep {
    const task = readTaskFile(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const fullStep: TaskStep = {
      ...step,
      id: task.steps.length + 1,
      timestamp: new Date().toISOString(),
    }
    task.steps.push(fullStep)

    // Accumulate token usage
    if (fullStep.tokenUsage) {
      task.tokenUsage += fullStep.tokenUsage
    }

    writeTaskFile(task)

    // Keep manifest token count in sync
    const manifest = readManifest()
    updateManifestEntry(manifest, task)
    writeManifest(manifest)

    return fullStep
  }

  /**
   * Mark a task as completed with an output string.
   */
  completeTask(id: string, output: string): void {
    const task = readTaskFile(id)
    if (!task) {
      throw new Error(`Task not found: ${id}`)
    }
    task.status = 'completed'
    task.completedAt = new Date().toISOString()
    task.output = output
    writeTaskFile(task)

    const manifest = readManifest()
    updateManifestEntry(manifest, task)
    writeManifest(manifest)
  }

  /**
   * Mark a task as failed with an error message.
   */
  failTask(id: string, error: string): void {
    const task = readTaskFile(id)
    if (!task) {
      throw new Error(`Task not found: ${id}`)
    }
    task.status = 'failed'
    task.completedAt = new Date().toISOString()
    task.error = error
    writeTaskFile(task)

    const manifest = readManifest()
    updateManifestEntry(manifest, task)
    writeManifest(manifest)
  }

  /**
   * Get a task by id (full task with steps).
   */
  getTask(id: string): Task | null {
    return readTaskFile(id)
  }

  /**
   * List tasks, optionally filtered by status. Returns manifest entries (no steps).
   */
  listTasks(filter?: TaskStatus): TaskManifestEntry[] {
    const manifest = readManifest()
    if (!filter) {
      return manifest
    }
    return manifest.filter(e => e.status === filter)
  }

  /**
   * Get the detailed step log for a task.
   */
  inspectTask(id: string): TaskStep[] | null {
    const task = readTaskFile(id)
    if (!task) {
      return null
    }
    return task.steps
  }

  /**
   * Compute aggregate statistics across all tasks.
   */
  getStats(): TaskQueueStats {
    const manifest = readManifest()
    const total = manifest.length
    const byStatus: Record<TaskStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    }

    let totalTokens = 0
    let totalDurationMs = 0
    let tasksWithDuration = 0

    for (const entry of manifest) {
      byStatus[entry.status]++
      totalTokens += entry.tokenUsage ?? 0

      if (entry.startedAt && entry.completedAt) {
        const start = new Date(entry.startedAt).getTime()
        const end = new Date(entry.completedAt).getTime()
        const duration = end - start
        if (duration > 0) {
          totalDurationMs += duration
          tasksWithDuration++
        }
      }
    }

    return {
      totalTasks: total,
      byStatus,
      avgTokens: total > 0 ? Math.round(totalTokens / total) : 0,
      avgDurationMs:
        tasksWithDuration > 0
          ? Math.round(totalDurationMs / tasksWithDuration)
          : 0,
      totalTokens,
    }
  }

  /**
   * Remove tasks older than the specified number of days.
   * Returns the count of pruned tasks.
   */
  pruneOld(daysOld: number): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
    const manifest = readManifest()
    const keep: TaskManifestEntry[] = []
    let pruned = 0

    for (const entry of manifest) {
      // Use completedAt, startedAt, or treat as old if neither exists
      const dateStr = entry.completedAt ?? entry.startedAt
      if (dateStr) {
        const ts = new Date(dateStr).getTime()
        if (ts < cutoff) {
          deleteTaskFile(entry.id)
          pruned++
          continue
        }
      }
      keep.push(entry)
    }

    writeManifest(keep)
    return pruned
  }

  /**
   * Get steps from a specific point for replay. If fromStep is omitted,
   * returns all steps.
   */
  replayTask(id: string, fromStep?: number): TaskStep[] | null {
    const task = readTaskFile(id)
    if (!task) {
      return null
    }
    if (fromStep === undefined) {
      return task.steps
    }
    return task.steps.filter(s => s.id >= fromStep)
  }

  /**
   * Remove all tasks and clear the manifest.
   * Returns the count of removed tasks.
   */
  clearAll(): number {
    const manifest = readManifest()
    const count = manifest.length
    for (const entry of manifest) {
      deleteTaskFile(entry.id)
    }
    writeManifest([])
    return count
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: TaskQueueManager | null = null

export function getTaskQueueManager(): TaskQueueManager {
  if (!instance) {
    instance = new TaskQueueManager()
  }
  return instance
}
