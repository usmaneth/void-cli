/**
 * `borda-count` consensus mode — each member ranks every other member's
 * answer; total Borda score wins.
 *
 * Borda scoring for N candidates (voter excluded): the top-ranked gets
 * (N - 1) points, second gets (N - 2), … last gets 0.  Totals are summed
 * across all voters; highest total wins. Ties go through the tiebreaker.
 *
 * Requires a 2nd pass where each member scores the others. The `bordaRank`
 * hook on ConsensusInput supplies the ranking; if it's missing we fall back
 * to a similarity-based heuristic (rank others by how close their answer is
 * to the voter's own).
 */
import type { ConsensusResult, ConsensusVote, CouncilResponse } from '../../types.js'
import { similarity } from '../similarity.js'
import { resolveTie } from '../tiebreaker.js'
import type { ConsensusInput } from '../types.js'

export async function runBordaCount(
  input: ConsensusInput,
): Promise<ConsensusResult> {
  const {
    responses,
    members,
    similarity: simCtx,
    tiebreaker,
    bordaRank,
    emit,
  } = input

  if (responses.length === 0) throw new Error('borda-count: no responses')
  if (responses.length === 1) {
    const only = responses[0]!
    return {
      winner: only,
      responses,
      method: 'borda-count',
      scores: [{ memberId: only.memberId, score: 0, reason: 'Single response' }],
      votes: [],
      outcome: 'decided',
      totalCostUSD: only.costUSD,
      totalLatencyMs: only.latencyMs,
    }
  }

  // Collect rankings. Each voter produces an ordered list of memberIds
  // (highest-preference first), excluding their own.
  const rankings: Array<{ voterId: string; ranked: string[] }> = []
  for (const voterResponse of responses) {
    const voter = members.find((m) => m.id === voterResponse.memberId)
    const candidates = responses.filter((r) => r.memberId !== voterResponse.memberId)
    let ranked: string[]

    if (bordaRank && voter) {
      try {
        ranked = await bordaRank(voter, candidates)
      } catch {
        ranked = await heuristicRank(voterResponse, candidates, simCtx)
      }
    } else {
      ranked = await heuristicRank(voterResponse, candidates, simCtx)
    }

    // Defensive: ensure every candidate is in the ranking exactly once.
    const present = new Set(ranked)
    for (const cand of candidates) {
      if (!present.has(cand.memberId)) ranked.push(cand.memberId)
    }
    ranked = ranked.filter((id) => candidates.some((c) => c.memberId === id))

    rankings.push({ voterId: voterResponse.memberId, ranked })
  }

  // Tally Borda scores. For each voter, award (N - 1 - rankIdx) points to the
  // candidate at position rankIdx. N is the number of candidates they ranked.
  const totals = new Map<string, number>()
  for (const r of responses) totals.set(r.memberId, 0)

  const votes: ConsensusVote[] = []
  for (const { voterId, ranked } of rankings) {
    const n = ranked.length
    for (let i = 0; i < ranked.length; i++) {
      const targetId = ranked[i]!
      const points = n - 1 - i
      totals.set(targetId, (totals.get(targetId) ?? 0) + points)
      votes.push({
        voterId,
        targetId,
        weight: points,
        reason: `Rank ${i + 1} of ${n} (${points} pts)`,
      })
    }
  }

  // Find max score and all tied members.
  let topScore = -Infinity
  for (const [, v] of totals) if (v > topScore) topScore = v
  const tied: string[] = [...totals.entries()]
    .filter(([, v]) => v === topScore)
    .map(([id]) => id)

  const scores = responses.map((r) => ({
    memberId: r.memberId,
    score: totals.get(r.memberId) ?? 0,
    reason: `Borda total: ${totals.get(r.memberId) ?? 0}`,
  }))

  if (tied.length === 1) {
    const winner = responses.find((r) => r.memberId === tied[0]!)!
    return {
      winner,
      responses,
      method: 'borda-count',
      scores,
      votes,
      outcome: 'decided',
      totalCostUSD: responses.reduce((s, r) => s + r.costUSD, 0),
      totalLatencyMs: Math.max(...responses.map((r) => r.latencyMs)),
    }
  }

  // Tie — resolve via tiebreaker.
  const tieRes = resolveTie({ tied, responses, members, tiebreaker })
  if (tieRes.retryRequested) {
    emit?.({
      type: 'no_consensus',
      method: 'borda-count',
      reason: `Tie at Borda total ${topScore} — retry requested`,
    })
  }
  return {
    winner: tieRes.winner,
    responses,
    method: 'borda-count',
    scores,
    votes,
    outcome: tieRes.retryRequested ? 'no-consensus' : 'decided',
    tiebreaker: { kind: tiebreaker, reason: tieRes.reason },
    totalCostUSD: responses.reduce((s, r) => s + r.costUSD, 0),
    totalLatencyMs: Math.max(...responses.map((r) => r.latencyMs)),
  }
}

/**
 * Fallback ranker — each voter ranks candidates by how closely their content
 * matches the voter's own content. Most-similar first.
 */
async function heuristicRank(
  voter: CouncilResponse,
  candidates: CouncilResponse[],
  simCtx: ConsensusInput['similarity'],
): Promise<string[]> {
  const scored: Array<{ id: string; score: number }> = []
  for (const c of candidates) {
    const s = await similarity(voter.content, c.content, simCtx)
    scored.push({ id: c.memberId, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.id)
}
