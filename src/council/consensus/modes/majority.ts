/**
 * `majority` consensus mode — plurality of semantically-equivalent answers wins.
 *
 * Each response is a "vote" cast by its own member for its own answer. We
 * cluster the answers via `similarity.cluster`, then pick the largest cluster.
 * Ties go through the configured tiebreaker.
 */
import type { ConsensusResult, ConsensusVote } from '../../types.js'
import { cluster } from '../similarity.js'
import { resolveTie, pickLeader } from '../tiebreaker.js'
import type { ConsensusInput } from '../types.js'

export async function runMajority(
  input: ConsensusInput,
  opts: { weighted?: boolean } = {},
): Promise<ConsensusResult> {
  const { responses, members, similarity: simCtx, tiebreaker, emit } = input
  const weighted = opts.weighted === true
  const method = weighted ? 'weighted-majority' : 'majority'

  if (responses.length === 0) {
    throw new Error(`${method}: no responses`)
  }

  // Validate weights on the weighted path — negative weights are rejected.
  if (weighted) {
    for (const m of members) {
      if (typeof m.weight === 'number' && m.weight < 0) {
        throw new Error(
          `${method}: negative weight rejected for member "${m.id}" (${m.weight})`,
        )
      }
    }
  }

  const assignments = await cluster(
    responses.map((r) => r.content),
    simCtx,
  )

  // Bucket into clusters; each bucket holds the responses that voted for it.
  const buckets = new Map<number, string[]>()
  for (let i = 0; i < responses.length; i++) {
    const cid = assignments[i]!
    const memberId = responses[i]!.memberId
    if (!buckets.has(cid)) buckets.set(cid, [])
    buckets.get(cid)!.push(memberId)
  }

  const votes: ConsensusVote[] = []
  const clusterWeight = new Map<number, number>()
  for (const [cid, voters] of buckets.entries()) {
    let w = 0
    for (const memberId of voters) {
      const member = members.find((m) => m.id === memberId)
      const voteW = weighted ? (member?.weight ?? 1) : 1
      w += voteW
      votes.push({
        voterId: memberId,
        targetId: memberId, // In majority, each member votes for their own cluster
        weight: voteW,
        reason: `Cluster ${cid}`,
      })
    }
    clusterWeight.set(cid, w)
  }

  // Handle edge case: all weights zero in weighted mode — degrade to unweighted.
  let effectiveWeights = clusterWeight
  let degradedReason: string | undefined
  if (weighted) {
    const totalW = [...clusterWeight.values()].reduce((a, b) => a + b, 0)
    if (totalW === 0) {
      degradedReason = 'All weights are zero — degrading to unweighted majority'
      effectiveWeights = new Map()
      for (const [cid, voters] of buckets.entries()) {
        effectiveWeights.set(cid, voters.length)
      }
    }
  }

  // Find max-weight clusters.
  let topWeight = -Infinity
  for (const w of effectiveWeights.values()) if (w > topWeight) topWeight = w
  const topClusters = [...effectiveWeights.entries()]
    .filter(([, w]) => w === topWeight)
    .map(([cid]) => cid)

  // Build scores (per-member) for UI — each member scores = their cluster's total weight.
  const scores = responses.map((r, i) => {
    const cid = assignments[i]!
    const w = effectiveWeights.get(cid) ?? 0
    return {
      memberId: r.memberId,
      score: w,
      reason: `Cluster ${cid} total ${weighted ? 'weighted ' : ''}votes: ${w}`,
    }
  })

  // Single winning cluster — pick the leader-most response within it.
  if (topClusters.length === 1) {
    const winCid = topClusters[0]!
    const winIds = buckets.get(winCid)!
    const winResponses = responses.filter((r) => winIds.includes(r.memberId))
    const winner = pickLeader(winResponses, members)
    return {
      winner,
      responses,
      method,
      scores,
      votes,
      outcome: 'decided',
      tiebreaker: degradedReason
        ? { kind: tiebreaker, reason: degradedReason }
        : undefined,
      totalCostUSD: responses.reduce((s, r) => s + r.costUSD, 0),
      totalLatencyMs: Math.max(...responses.map((r) => r.latencyMs)),
    }
  }

  // Tie across clusters — collect all tied memberIds, hand to tiebreaker.
  const tiedIds: string[] = []
  for (const cid of topClusters) tiedIds.push(...buckets.get(cid)!)
  const res = resolveTie({
    tied: tiedIds,
    responses,
    members,
    tiebreaker,
  })
  if (res.retryRequested) {
    emit?.({
      type: 'no_consensus',
      method,
      reason: `Tie across ${topClusters.length} clusters — retry requested`,
    })
    return {
      winner: res.winner,
      responses,
      method,
      scores,
      votes,
      outcome: 'no-consensus',
      tiebreaker: { kind: tiebreaker, reason: res.reason },
      totalCostUSD: responses.reduce((s, r) => s + r.costUSD, 0),
      totalLatencyMs: Math.max(...responses.map((r) => r.latencyMs)),
    }
  }
  return {
    winner: res.winner,
    responses,
    method,
    scores,
    votes,
    outcome: 'decided',
    tiebreaker: { kind: tiebreaker, reason: res.reason },
    totalCostUSD: responses.reduce((s, r) => s + r.costUSD, 0),
    totalLatencyMs: Math.max(...responses.map((r) => r.latencyMs)),
  }
}
