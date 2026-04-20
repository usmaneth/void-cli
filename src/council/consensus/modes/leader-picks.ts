/**
 * `leader-picks` consensus mode — the first (leader) member's answer wins.
 *
 * Preserved from the original orchestrator; no voting, no similarity needed.
 * Fast, deterministic, good default for "trust the primary model".
 */
import type { ConsensusResult } from '../../types.js'
import type { ConsensusInput } from '../types.js'

export async function runLeaderPicks(
  input: ConsensusInput,
): Promise<ConsensusResult> {
  const { responses, members } = input
  if (responses.length === 0) {
    throw new Error('leader-picks: no responses')
  }
  // Prefer the first member (leader) in configured order; fall back to first
  // response if the leader errored out.
  const leaderId = members[0]?.id
  const leader =
    responses.find((r) => r.memberId === leaderId) ?? responses[0]!
  const scores = responses.map((r) => ({
    memberId: r.memberId,
    score: r === leader ? 1 : 0.5,
    reason: r === leader ? 'Leader selection' : 'Alternative perspective',
  }))
  return {
    winner: leader,
    responses,
    method: 'leader-picks',
    scores,
    votes: [],
    outcome: 'decided',
    totalCostUSD: responses.reduce((s, r) => s + r.costUSD, 0),
    totalLatencyMs: Math.max(...responses.map((r) => r.latencyMs)),
  }
}
