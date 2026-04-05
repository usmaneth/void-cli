/**
 * Workstream Manager — Multi-Workstream Engine
 *
 * Manages concurrent agent workstreams within a single void instance.
 * Each workstream has isolated conversation history and execution steps.
 * Uses only Node.js built-ins (fs, path, os, crypto).
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkstreamStatus = 'running' | 'paused' | 'completed' | 'failed'

export type WorkstreamConfig = {
  maxConcurrent: number
  isolateGit: boolean
  autoBranch: boolean
}

export type Workstream = {
  id: string
  name: string
  instruction: string
  status: WorkstreamStatus
  agentTemplate?: string
  branch?: string
  steps: WorkstreamStep[]
  messages: any[]
  tokenUsage: number
  startedAt: string
  pausedAt?: string
  completedAt?: string
  error?: string
}

export type WorkstreamStep = {
  id: number
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  timestamp: string
}

type WorkstreamManifest = {
  workstreams: Record<string, { id: string; name: string; status: WorkstreamStatus; startedAt: string }>
  focusedId: string | null
  config: WorkstreamConfig
}

type WorkstreamMetrics = {
  totalCreated: number
  running: number
  paused: number
  completed: number
  failed: number
  totalTokens: number
  totalSteps: number
  completedSteps: number
}

type WorkstreamStatusOverview = {
  running: number
  paused: number
  completed: number
  failed: number
  total: number
}

type WorkstreamCreateOptions = {
  agentTemplate?: string
  branch?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_DIR = join(homedir(), '.void', 'workstreams')
const MANIFEST_PATH = join(STORAGE_DIR, 'manifest.json')
const CLEANUP_AGE_MS = 60 * 60 * 1000 // 1 hour

const DEFAULT_CONFIG: WorkstreamConfig = {
  maxConcurrent: 5,
  isolateGit: false,
  autoBranch: false,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return randomUUID().slice(0, 6)
}

function ensureStorageDir(): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true })
  }
}

function readManifest(): WorkstreamManifest {
  ensureStorageDir()
  if (!existsSync(MANIFEST_PATH)) {
    const manifest: WorkstreamManifest = {
      workstreams: {},
      focusedId: null,
      config: { ...DEFAULT_CONFIG },
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8')
    return manifest
  }
  try {
    const raw = readFileSync(MANIFEST_PATH, 'utf-8')
    return JSON.parse(raw) as WorkstreamManifest
  } catch {
    const manifest: WorkstreamManifest = {
      workstreams: {},
      focusedId: null,
      config: { ...DEFAULT_CONFIG },
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8')
    return manifest
  }
}

function writeManifest(manifest: WorkstreamManifest): void {
  ensureStorageDir()
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8')
}

function workstreamPath(id: string): string {
  return join(STORAGE_DIR, `${id}.json`)
}

function readWorkstream(id: string): Workstream | undefined {
  const filePath = workstreamPath(id)
  if (!existsSync(filePath)) return undefined
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Workstream
  } catch {
    return undefined
  }
}

function writeWorkstream(ws: Workstream): void {
  ensureStorageDir()
  writeFileSync(workstreamPath(ws.id), JSON.stringify(ws, null, 2), 'utf-8')
}

function deleteWorkstream(id: string): void {
  const filePath = workstreamPath(id)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

// ---------------------------------------------------------------------------
// WorkstreamManager
// ---------------------------------------------------------------------------

export class WorkstreamManager {
  private manifest: WorkstreamManifest
  private cache: Map<string, Workstream> = new Map()

  constructor() {
    this.manifest = readManifest()
    this.loadCache()
  }

  // -----------------------------------------------------------------------
  // Cache management
  // -----------------------------------------------------------------------

  private loadCache(): void {
    for (const id of Object.keys(this.manifest.workstreams)) {
      const ws = readWorkstream(id)
      if (ws) {
        this.cache.set(id, ws)
      }
    }
  }

  private persist(ws: Workstream): void {
    this.cache.set(ws.id, ws)
    writeWorkstream(ws)
    this.manifest.workstreams[ws.id] = {
      id: ws.id,
      name: ws.name,
      status: ws.status,
      startedAt: ws.startedAt,
    }
    writeManifest(this.manifest)
  }

  // -----------------------------------------------------------------------
  // Core operations
  // -----------------------------------------------------------------------

  /**
   * Create and start a new workstream.
   * Throws if the max concurrent running workstream limit is reached.
   */
  create(name: string, instruction: string, options?: WorkstreamCreateOptions): Workstream {
    const runningCount = this.countByStatus('running')
    if (runningCount >= this.manifest.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent workstreams reached (${this.manifest.config.maxConcurrent}). ` +
        `Pause or kill a running workstream first.`,
      )
    }

    const id = generateId()
    const now = new Date().toISOString()

    const ws: Workstream = {
      id,
      name,
      instruction,
      status: 'running',
      agentTemplate: options?.agentTemplate,
      branch: options?.branch,
      steps: [],
      messages: [],
      tokenUsage: 0,
      startedAt: now,
    }

    this.persist(ws)

    // Auto-focus if this is the only workstream
    if (Object.keys(this.manifest.workstreams).length === 1) {
      this.manifest.focusedId = id
      writeManifest(this.manifest)
    }

    return ws
  }

  /**
   * List all workstreams.
   */
  list(): Workstream[] {
    const result: Workstream[] = []
    for (const id of Object.keys(this.manifest.workstreams)) {
      const ws = this.cache.get(id) ?? readWorkstream(id)
      if (ws) {
        this.cache.set(id, ws)
        result.push(ws)
      }
    }
    return result
  }

  /**
   * Get a single workstream by id.
   */
  get(id: string): Workstream | undefined {
    const cached = this.cache.get(id)
    if (cached) return cached
    const ws = readWorkstream(id)
    if (ws) {
      this.cache.set(id, ws)
    }
    return ws
  }

  /**
   * Pause a running workstream.
   */
  pause(id: string): Workstream {
    const ws = this.requireWorkstream(id)
    if (ws.status !== 'running') {
      throw new Error(`Workstream "${ws.name}" is not running (status: ${ws.status}).`)
    }
    ws.status = 'paused'
    ws.pausedAt = new Date().toISOString()
    this.persist(ws)
    return ws
  }

  /**
   * Resume a paused workstream.
   */
  resume(id: string): Workstream {
    const ws = this.requireWorkstream(id)
    if (ws.status !== 'paused') {
      throw new Error(`Workstream "${ws.name}" is not paused (status: ${ws.status}).`)
    }

    const runningCount = this.countByStatus('running')
    if (runningCount >= this.manifest.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent workstreams reached (${this.manifest.config.maxConcurrent}). ` +
        `Pause or kill a running workstream first.`,
      )
    }

    ws.status = 'running'
    ws.pausedAt = undefined
    this.persist(ws)
    return ws
  }

  /**
   * Terminate a workstream.
   */
  kill(id: string): Workstream {
    const ws = this.requireWorkstream(id)
    if (ws.status === 'completed' || ws.status === 'failed') {
      throw new Error(`Workstream "${ws.name}" has already ended (status: ${ws.status}).`)
    }
    ws.status = 'failed'
    ws.error = 'Terminated by user'
    ws.completedAt = new Date().toISOString()
    this.persist(ws)

    // If this was the focused workstream, clear focus
    if (this.manifest.focusedId === id) {
      this.manifest.focusedId = this.findNextFocusable(id)
      writeManifest(this.manifest)
    }

    return ws
  }

  /**
   * Set the active workstream for display.
   */
  switchFocus(id: string): Workstream {
    const ws = this.requireWorkstream(id)
    this.manifest.focusedId = id
    writeManifest(this.manifest)
    return ws
  }

  /**
   * Get the currently focused workstream, or undefined.
   */
  getFocused(): Workstream | undefined {
    if (!this.manifest.focusedId) return undefined
    return this.get(this.manifest.focusedId)
  }

  /**
   * Get step log for a workstream.
   * Optionally limit to the last `tail` entries.
   */
  getLogs(id: string, tail?: number): WorkstreamStep[] {
    const ws = this.requireWorkstream(id)
    if (tail !== undefined && tail > 0) {
      return ws.steps.slice(-tail)
    }
    return [...ws.steps]
  }

  /**
   * Get overview stats: running count, paused, completed, failed.
   */
  getStatus(): WorkstreamStatusOverview {
    const all = this.list()
    return {
      running: all.filter(w => w.status === 'running').length,
      paused: all.filter(w => w.status === 'paused').length,
      completed: all.filter(w => w.status === 'completed').length,
      failed: all.filter(w => w.status === 'failed').length,
      total: all.length,
    }
  }

  // -----------------------------------------------------------------------
  // Step management
  // -----------------------------------------------------------------------

  /**
   * Add an execution step to a workstream.
   */
  addStep(id: string, step: Omit<WorkstreamStep, 'id' | 'timestamp'>): WorkstreamStep {
    const ws = this.requireWorkstream(id)
    const newStep: WorkstreamStep = {
      id: ws.steps.length + 1,
      description: step.description,
      status: step.status,
      result: step.result,
      timestamp: new Date().toISOString(),
    }
    ws.steps.push(newStep)
    this.persist(ws)
    return newStep
  }

  /**
   * Mark a step as completed with an optional result.
   */
  completeStep(id: string, stepId: number, result?: string): WorkstreamStep {
    const ws = this.requireWorkstream(id)
    const step = ws.steps.find(s => s.id === stepId)
    if (!step) {
      throw new Error(`Step ${stepId} not found in workstream "${ws.name}".`)
    }
    step.status = 'completed'
    step.result = result
    step.timestamp = new Date().toISOString()
    this.persist(ws)
    return step
  }

  // -----------------------------------------------------------------------
  // Terminal states
  // -----------------------------------------------------------------------

  /**
   * Mark workstream as completed.
   */
  complete(id: string, result?: string): Workstream {
    const ws = this.requireWorkstream(id)
    if (ws.status !== 'running' && ws.status !== 'paused') {
      throw new Error(`Workstream "${ws.name}" cannot be completed (status: ${ws.status}).`)
    }
    ws.status = 'completed'
    ws.completedAt = new Date().toISOString()

    // Mark any pending/running steps as completed
    for (const step of ws.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'completed'
        step.result = step.result ?? 'Completed with workstream'
        step.timestamp = new Date().toISOString()
      }
    }

    if (result) {
      this.addStep(id, { description: 'Workstream completed', status: 'completed', result })
    }

    this.persist(ws)

    // Switch focus if needed
    if (this.manifest.focusedId === id) {
      this.manifest.focusedId = this.findNextFocusable(id)
      writeManifest(this.manifest)
    }

    return ws
  }

  /**
   * Mark workstream as failed.
   */
  fail(id: string, error: string): Workstream {
    const ws = this.requireWorkstream(id)
    ws.status = 'failed'
    ws.error = error
    ws.completedAt = new Date().toISOString()

    // Mark any running steps as failed
    for (const step of ws.steps) {
      if (step.status === 'running') {
        step.status = 'failed'
        step.result = `Failed: ${error}`
        step.timestamp = new Date().toISOString()
      }
    }

    this.persist(ws)

    // Switch focus if needed
    if (this.manifest.focusedId === id) {
      this.manifest.focusedId = this.findNextFocusable(id)
      writeManifest(this.manifest)
    }

    return ws
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Remove completed/failed workstreams older than 1 hour.
   * Returns the number of workstreams removed.
   */
  cleanup(): number {
    const now = Date.now()
    let removed = 0

    for (const [id, entry] of Object.entries(this.manifest.workstreams)) {
      const ws = this.cache.get(id) ?? readWorkstream(id)
      if (!ws) {
        // Orphaned manifest entry — clean up
        delete this.manifest.workstreams[id]
        removed++
        continue
      }

      if (
        (ws.status === 'completed' || ws.status === 'failed') &&
        ws.completedAt
      ) {
        const completedTime = new Date(ws.completedAt).getTime()
        if (now - completedTime >= CLEANUP_AGE_MS) {
          deleteWorkstream(id)
          this.cache.delete(id)
          delete this.manifest.workstreams[id]
          if (this.manifest.focusedId === id) {
            this.manifest.focusedId = null
          }
          removed++
        }
      }
    }

    if (removed > 0) {
      writeManifest(this.manifest)
    }

    return removed
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Get the current workstream configuration.
   */
  getConfig(): WorkstreamConfig {
    return { ...this.manifest.config }
  }

  /**
   * Update workstream configuration.
   */
  setConfig(config: Partial<WorkstreamConfig>): WorkstreamConfig {
    if (config.maxConcurrent !== undefined) {
      if (config.maxConcurrent < 1 || config.maxConcurrent > 20) {
        throw new Error('maxConcurrent must be between 1 and 20.')
      }
      this.manifest.config.maxConcurrent = config.maxConcurrent
    }
    if (config.isolateGit !== undefined) {
      this.manifest.config.isolateGit = config.isolateGit
    }
    if (config.autoBranch !== undefined) {
      this.manifest.config.autoBranch = config.autoBranch
    }
    writeManifest(this.manifest)
    return this.getConfig()
  }

  // -----------------------------------------------------------------------
  // Metrics
  // -----------------------------------------------------------------------

  /**
   * Aggregate metrics across all workstreams.
   */
  getMetrics(): WorkstreamMetrics {
    const all = this.list()
    let totalTokens = 0
    let totalSteps = 0
    let completedSteps = 0

    for (const ws of all) {
      totalTokens += ws.tokenUsage
      totalSteps += ws.steps.length
      completedSteps += ws.steps.filter(s => s.status === 'completed').length
    }

    return {
      totalCreated: all.length,
      running: all.filter(w => w.status === 'running').length,
      paused: all.filter(w => w.status === 'paused').length,
      completed: all.filter(w => w.status === 'completed').length,
      failed: all.filter(w => w.status === 'failed').length,
      totalTokens,
      totalSteps,
      completedSteps,
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private requireWorkstream(id: string): Workstream {
    const ws = this.get(id)
    if (!ws) {
      throw new Error(`Workstream "${id}" not found.`)
    }
    return ws
  }

  private countByStatus(status: WorkstreamStatus): number {
    let count = 0
    for (const entry of Object.values(this.manifest.workstreams)) {
      if (entry.status === status) count++
    }
    return count
  }

  private findNextFocusable(excludeId: string): string | null {
    for (const [id, entry] of Object.entries(this.manifest.workstreams)) {
      if (id !== excludeId && (entry.status === 'running' || entry.status === 'paused')) {
        return id
      }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: WorkstreamManager | undefined

export function getWorkstreamManager(): WorkstreamManager {
  if (!instance) {
    instance = new WorkstreamManager()
  }
  return instance
}
