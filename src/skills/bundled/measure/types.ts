/**
 * Shared types for the /measure eval harness.
 *
 * The harness samples real prompts from the user's history, replays each one
 * against one or more *variants* (a tool + optional model override), and
 * aggregates the resulting metrics into a markdown report.
 *
 * "Variant" is the unit of comparison. A variant binds a specific tool
 * binary (void, claude, codex, opencode) at a specific version, optionally
 * with a model override. This lets us answer the real question — "is void
 * still keeping pace with vanilla claude code?" — instead of just comparing
 * model swaps inside void.
 */

/** A single prompt sampled from history that we will replay. */
export type PromptEntry = {
  display: string
  timestamp: number
  project: string
  sessionId: string
}

/** Tools whose CLI surfaces /measure knows how to drive. */
export const TOOL_NAMES = ['void', 'claude', 'codex', 'opencode'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

/** A tool that was found on PATH (or via env override) at detect time. */
export type DetectedTool = {
  name: ToolName
  /** Absolute path to the executable. */
  binary: string
  /** Version string captured at detect time (`<binary> --version` output). */
  version: string
}

/**
 * A specific configuration we'll replay against. Different variants can
 * point at the same tool at different model overrides — e.g. `void@opus`
 * and `void@sonnet` are distinct variants of the void tool.
 */
export type Variant = {
  /** Stable identifier for grouping + display. e.g. `void`, `void@opus`, `claude@2.1.119`. */
  id: string
  tool: ToolName
  binary: string
  version: string
  /** Model override; falsy = use tool's default model. */
  model?: string
}

/**
 * Result of one replay (one prompt × one variant). Numbers default to 0
 * when the parser couldn't extract them; the boolean flags below tell the
 * report renderer when a column should show "—" instead of a misleading 0.
 */
export type ReplayResult = {
  prompt: string
  variantId: string
  tool: ToolName
  version: string
  ok: boolean
  /** USD cost. 0 with `costAvailable: false` when the parser couldn't extract it. */
  costUsd: number
  costAvailable: boolean
  /** Wall-clock latency in ms. Always populated (even on failure). */
  latencyMs: number
  /** Tool-reported API latency. -1 when not available. */
  apiLatencyMs: number
  /** Conversation turn count. -1 when not available. */
  numTurns: number
  /** Length of the final assistant message. 0 when no message captured. */
  finalMessageChars: number
  /** Tool-reported session id, if any. */
  sessionId: string
  error?: string
  rawExitCode: number
}

/** Aggregated stats across many replays for a single variant. */
export type VariantStats = {
  variantId: string
  tool: ToolName
  version: string
  count: number
  successCount: number
  successRate: number
  cost: AggStats
  /** True when at least one replay reported a cost. */
  costAvailable: boolean
  latency: AggStats
  /** True when at least one replay reported turn count. */
  turnsAvailable: boolean
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

/**
 * Result schema we extract from claude/void's `--output-format json`. Codex
 * and opencode parsers emit the same shape so downstream code stays unified;
 * fields they can't fill are left at 0/-1 (and `costAvailable`/etc on the
 * ReplayResult flag that).
 */
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

/** Options accepted by the top-level runner. */
export type MeasureOptions = {
  n: number
  variants: Variant[]
  projectPath: string
  historyPath: string
  vaultDir: string
  timeoutMs: number
  parallel: number
}

export const DEFAULT_PARALLEL = 2
export const MAX_PARALLEL = 4
export const DEFAULT_N = 10
export const MAX_N = 50
export const DEFAULT_TIMEOUT_MS = 60_000
export const MIN_PROMPT_CHARS = 10
