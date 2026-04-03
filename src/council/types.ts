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

export type ConsensusResult = {
  /** The winning response */
  winner: CouncilResponse
  /** All responses for comparison */
  responses: CouncilResponse[]
  /** Consensus method used */
  method: ConsensusMethod
  /** Scores per member */
  scores: Array<{ memberId: string; score: number; reason: string }>
  /** Total cost of the council round */
  totalCostUSD: number
  /** Total latency (wall clock, since parallel) */
  totalLatencyMs: number
}

export type ConsensusMethod = 'leader-picks' | 'voting' | 'longest' | 'first'

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
}

export type CouncilEvent =
  | { type: 'council_start'; members: CouncilMember[] }
  | { type: 'member_start'; memberId: string }
  | { type: 'member_streaming'; memberId: string; text: string }
  | { type: 'member_complete'; memberId: string; response: CouncilResponse }
  | { type: 'member_error'; memberId: string; error: string }
  | { type: 'consensus_start'; method: ConsensusMethod }
  | { type: 'consensus_complete'; result: ConsensusResult }
  | { type: 'council_complete'; result: ConsensusResult }
