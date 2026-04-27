/**
 * Shared types for the /measure eval harness.
 *
 * The harness samples real prompts from the user's history, replays each one
 * against one or more model configurations via `void -p ... --output-format
 * json`, and aggregates the resulting metrics into a markdown report.
 */

/** A single prompt sampled from history that we will replay. */
export type PromptEntry = {
  display: string
  timestamp: number
  project: string
  sessionId: string
}

/** Metadata from the SDK result JSON (a subset of SDKResultSuccessSchema). */
export type SDKResultJson = {
  type: 'result'
  subtype: string
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  result?: string
  total_cost_usd: number
  session_id: string
}

/** One replay outcome — either success with metrics or failure with error. */
export type ReplayResult = {
  prompt: string
  model: string
  ok: boolean
  costUsd: number
  latencyMs: number
  apiLatencyMs: number
  numTurns: number
  finalMessageChars: number
  sessionId: string
  error?: string
  rawExitCode: number
}

/** Aggregated stats across many replays for a single model. */
export type ModelStats = {
  model: string
  count: number
  successCount: number
  successRate: number
  cost: AggStats
  latency: AggStats
  turns: AggStats
  messageChars: AggStats
}

/** Aggregate statistics over a set of numeric values. */
export type AggStats = {
  mean: number
  median: number
  p95: number
  min: number
  max: number
}

/** Options accepted by the top-level runner. */
export type MeasureOptions = {
  n: number
  models: string[]
  projectPath: string
  historyPath: string
  vaultDir: string
  timeoutMs: number
  parallel: number
  voidBin: string
}

export const DEFAULT_PARALLEL = 2
export const MAX_PARALLEL = 4
export const DEFAULT_N = 10
export const MAX_N = 50
export const DEFAULT_TIMEOUT_MS = 60_000
export const MIN_PROMPT_CHARS = 10
