/**
 * Council Mode — Multi-model orchestration types.
 *
 * Run multiple AI models in parallel, compare responses,
 * and select the best via consensus voting.
 */

export type CouncilMember = {
  /** Unique identifier for this council member */
  id: string
  /** Display name */
  name: string
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4', 'openai/gpt-4o') */
  model: string
  /** Provider: 'anthropic' for direct, 'openrouter' for OpenRouter */
  provider: 'anthropic' | 'openrouter'
  /** Weight in consensus voting (0-1, default 1) */
  weight: number
  /** Whether this member can execute tools */
  canExecuteTools: boolean
  /** Role description for the council member */
  role?: string
}

export type CouncilPreset = {
  name: string
  description: string
  members: CouncilMember[]
}

export type CouncilResponse = {
  memberId: string
  memberName: string
  model: string
  content: string
  /** Raw response text */
  rawText: string
  /** Tool use blocks if any */
  toolUses: Array<{ name: string; input: Record<string, unknown> }>
  /** Time taken in ms */
  latencyMs: number
  /** Token usage */
  tokens: { input: number; output: number }
  /** Cost in USD */
  costUSD: number
}

/** A vote cast during consensus — used by majority / weighted / unanimous / borda modes. */
export type ConsensusVote = {
  /** Member that cast the vote */
  voterId: string
  /** Target response memberId */
  targetId: string
  /** Weight of the vote (from member.weight for weighted-majority, 1 otherwise) */
  weight: number
  /** Human-readable reason / rank */
  reason: string
}

/** Outcome state for a consensus run. */
export type ConsensusOutcome = 'decided' | 'no-consensus'

export type ConsensusResult = {
  /** The winning response (falls back to leader when no-consensus + tiebreaker='leader') */
  winner: CouncilResponse
  /** All responses for comparison */
  responses: CouncilResponse[]
  /** Consensus method used */
  method: ConsensusMethod
  /** Scores per member */
  scores: Array<{ memberId: string; score: number; reason: string }>
  /** Explicit vote log (empty for methods that don't vote, like leader-picks / longest / first) */
  votes?: ConsensusVote[]
  /** Outcome — 'no-consensus' when unanimity fails or ties can't be broken. */
  outcome?: ConsensusOutcome
  /** Whether a tiebreaker fired and how it resolved. */
  tiebreaker?: { kind: TiebreakerMode; reason: string } | undefined
  /** Number of retries executed (unanimous mode) */
  retries?: number
  /** Total cost of the council round */
  totalCostUSD: number
  /** Total latency (wall clock, since parallel) */
  totalLatencyMs: number
}

/**
 * Consensus selection modes.
 *
 * - `leader-picks`   — the first (leader) member's answer wins. Fast, no voting.
 * - `majority`       — plurality of semantically-equivalent answers wins.
 * - `weighted-majority` — like `majority` but each vote is weighted by `member.weight`.
 * - `unanimous`      — all members must agree; re-runs with a converge prompt if not.
 * - `borda-count`    — members rank every other response; total Borda score wins.
 *                      Requires a 2nd pass per member — expensive.
 *
 * Legacy modes kept for backwards compatibility (legacy orchestrator path only):
 * - `voting`, `longest`, `first`
 */
export type ConsensusMethod =
  | 'leader-picks'
  | 'majority'
  | 'weighted-majority'
  | 'unanimous'
  | 'borda-count'
  | 'voting'
  | 'longest'
  | 'first'

/** How to resolve ties / no-consensus when a mode can't produce a single winner. */
export type TiebreakerMode = 'leader' | 'random' | 'retry'

export type CouncilConfig = {
  /** Whether council mode is active */
  enabled: boolean
  /** Active council preset name or 'custom' */
  preset: string
  /** Council members */
  members: CouncilMember[]
  /** How to pick the winner */
  consensusMethod: ConsensusMethod
  /** Timeout per member in ms */
  memberTimeoutMs: number
  /** Whether to show all responses or just the winner */
  showAllResponses: boolean
  /** Whether the leader (first member) gets to pick the best response */
  leaderPicks: boolean
  /** Tiebreaker for ties / no-consensus. Default 'leader'. */
  tiebreaker?: TiebreakerMode
  /** Max retries for unanimous mode. Default 2. */
  unanimousMaxRetries?: number
}

export type CouncilEvent =
  | { type: 'council_start'; members: CouncilMember[] }
  | { type: 'member_start'; memberId: string }
  | { type: 'member_streaming'; memberId: string; text: string }
  | { type: 'member_complete'; memberId: string; response: CouncilResponse }
  | { type: 'member_error'; memberId: string; error: string }
  | { type: 'consensus_start'; method: ConsensusMethod }
  | { type: 'consensus_retry'; attempt: number; reason: string }
  | { type: 'consensus_no_consensus'; method: ConsensusMethod; reason: string }
  | { type: 'consensus_complete'; result: ConsensusResult }
  | { type: 'council_complete'; result: ConsensusResult }
