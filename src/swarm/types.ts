/**
 * Swarm Mode — Multi-model parallel workstream types.
 *
 * Decomposes a feature into independent workstreams, assigns each to a
 * specialist model, runs them in parallel git worktrees, and merges the
 * results back together.
 */

// ---------------------------------------------------------------------------
// Domain & model assignment
// ---------------------------------------------------------------------------

export type WorkstreamDomain =
  | 'frontend'
  | 'backend'
  | 'wiring'
  | 'tests'
  | 'debugging'
  | 'custom'

/**
 * Default model for each domain. Used when the coordinator does not
 * specify an explicit model override for a workstream.
 */
export const DEFAULT_MODEL_ASSIGNMENTS: Record<WorkstreamDomain, string> = {
  frontend: 'google/gemini-3.1-pro',
  backend: 'openai/gpt-5.4',
  wiring: 'claude-opus-4-6',
  tests: 'claude-sonnet-4-6',
  debugging: 'claude-opus-4-6',
  custom: 'claude-opus-4-6',
}

// ---------------------------------------------------------------------------
// Task & workstream
// ---------------------------------------------------------------------------

export type WorkstreamTask = {
  /** Human-readable description of the task */
  description: string
  /** Status of this individual task */
  status: 'pending' | 'in-progress' | 'done' | 'failed'
  /** Optional file path this task primarily touches */
  file?: string
}

export type Workstream = {
  /** Unique identifier (e.g. "ws-frontend-1") */
  id: string
  /** Short display name */
  name: string
  /** Domain classification */
  domain: WorkstreamDomain
  /** Model to use for this workstream */
  model: string
  /** High-level description of what this workstream accomplishes */
  description: string
  /** File/directory scope — paths this workstream is allowed to touch */
  scope: string[]
  /** Ordered list of subtasks */
  tasks: WorkstreamTask[]
  /** Current status */
  status: 'pending' | 'running' | 'done' | 'failed'
  /** Git worktree path (set at runtime) */
  worktreePath?: string
  /** Git branch name used by this worktree */
  worktreeBranch?: string
}

// ---------------------------------------------------------------------------
// Swarm configuration
// ---------------------------------------------------------------------------

export type SwarmConfig = {
  /** Human description of the overall feature being built */
  description: string
  /** Workstreams decomposed by the coordinator */
  workstreams: Workstream[]
  /** Model used for the coordinator (decomposition + review) */
  coordinator: string
  /** Whether to auto-merge worktree branches after workers complete */
  autoMerge: boolean
  /** Whether to run a review pass after merging */
  reviewAfterMerge: boolean
  /** Maximum number of workers to run in parallel */
  maxWorkersParallel: number
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export type SwarmPhase =
  | 'idle'
  | 'decomposing'
  | 'awaiting_approval'
  | 'working'
  | 'merging'
  | 'reviewing'
  | 'complete'
  | 'failed'

export type SwarmState = {
  /** The active configuration */
  config: SwarmConfig
  /** Current phase of the swarm lifecycle */
  phase: SwarmPhase
  /** Live workstream state (mirrors config.workstreams but updated at runtime) */
  workstreams: Workstream[]
  /** Accumulated cost across all workers */
  totalCostUSD: number
  /** Epoch ms when the swarm was started */
  startTime: number
}

// ---------------------------------------------------------------------------
// Callbacks for UI updates
// ---------------------------------------------------------------------------

export type SwarmCallbacks = {
  onDecomposed?: (workstreams: Workstream[]) => void
  onWorkerStart?: (workstream: Workstream) => void
  onWorkerProgress?: (workstream: Workstream, message: string) => void
  onWorkerComplete?: (workstream: Workstream) => void
  onWorkerFailed?: (workstream: Workstream, error: Error) => void
  onMergeStart?: () => void
  onMergeComplete?: (result: MergeResult) => void
  onReviewStart?: () => void
  onComplete?: (state: SwarmState) => void
}

// ---------------------------------------------------------------------------
// Merge result
// ---------------------------------------------------------------------------

export type MergeResult = {
  success: boolean
  conflicts: number
  conflictFiles: string[]
}
