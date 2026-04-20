/**
 * `unanimous` consensus mode — all members must agree.
 *
 * Algorithm:
 *   1. Cluster all responses via similarity.
 *   2. If exactly one cluster covers every member → decided, pick leader in cluster.
 *   3. Otherwise, if `rerun` hook is supplied and retries remain, re-run the
 *      members with a converge prompt and try again (up to `unanimousMaxRetries`).
 *   4. If retries exhausted, emit `no_consensus` and:
 *        - if tiebreaker is 'retry', caller already retried — fall back to leader.
 *        - otherwise apply tiebreaker across all responses.
 *
 * A "cluster of size N" where N is the number of distinct members that
 * contributed responses counts as unanimous. Missing members (errored out)
 * do not block consensus — we only require unanimity among those who answered.
 */
import type { ConsensusResult, ConsensusVote, CouncilResponse } from '../../types.js'
import { cluster } from '../similarity.js'
import { pickLeader, resolveTie } from '../tiebreaker.js'
import type { ConsensusInput } from '../types.js'

export async function runUnanimous(
  input: ConsensusInput,
): Promise<ConsensusResult> {
  const {
    members,
    similarity: simCtx,
    tiebreaker,
    unanimousMaxRetries,
    rerun,
    emit,
  } = input

  let currentResponses = input.responses
  let attempt = 0

  while (true) {
    if (currentResponses.length === 0) {
      throw new Error('unanimous: no responses')
    }

    const assignments = await cluster(
      currentResponses.map((r) => r.content),
      simCtx,
    )

    // Find the dominant cluster and check if it covers every response.
    const buckets = new Map<number, CouncilResponse[]>()
    for (let i = 0; i < currentResponses.length; i++) {
      const cid = assignments[i]!
      if (!buckets.has(cid)) buckets.set(cid, [])
      buckets.get(cid)!.push(currentResponses[i]!)
    }

    const clusters = [...buckets.values()]
    if (clusters.length === 1) {
      // Unanimous — all answered members agree.
      const winCluster = clusters[0]!
      const winner = pickLeader(winCluster, members)
      return buildResult({
        winner,
        responses: currentResponses,
        outcome: 'decided',
        scores: currentResponses.map((r) => ({
          memberId: r.memberId,
          score: 1,
          reason: 'Unanimous agreement',
        })),
        votes: currentResponses.map((r) => ({
          voterId: r.memberId,
          targetId: winner.memberId,
          weight: 1,
          reason: 'Unanimous vote',
        })),
        retries: attempt,
      })
    }

    // Not unanimous — retry if we still can.
    if (attempt < unanimousMaxRetries && rerun) {
      attempt += 1
      const reason = `Split across ${clusters.length} clusters — re-running (attempt ${attempt}/${unanimousMaxRetries})`
      emit?.({ type: 'retry', attempt, reason })
      const convergePrompt = buildConvergePrompt(currentResponses)
      try {
        const next = await rerun(convergePrompt, attempt)
        if (next.length === 0) {
          // Re-run returned nothing — bail out with the prior set.
          break
        }
        currentResponses = next
        continue
      } catch {
        // Re-run failed — break out and fall through to tiebreaker.
        break
      }
    }
    break
  }

  // Retries exhausted or unavailable — return no-consensus with a tiebreaker winner.
  const assignments = await cluster(
    currentResponses.map((r) => r.content),
    simCtx,
  )
  const buckets = new Map<number, CouncilResponse[]>()
  for (let i = 0; i < currentResponses.length; i++) {
    const cid = assignments[i]!
    if (!buckets.has(cid)) buckets.set(cid, [])
    buckets.get(cid)!.push(currentResponses[i]!)
  }
  // Largest cluster — then tiebreak to a single winner.
  let largest: CouncilResponse[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length > largest.length) largest = bucket
  }
  const tied = largest.map((r) => r.memberId)
  const tieRes = resolveTie({
    tied,
    responses: currentResponses,
    members,
    tiebreaker,
  })
  emit?.({
    type: 'no_consensus',
    method: 'unanimous',
    reason: `No unanimous agreement after ${attempt} retries`,
  })

  const votes: ConsensusVote[] = currentResponses.map((r) => ({
    voterId: r.memberId,
    targetId: r.memberId,
    weight: 1,
    reason: 'Own answer (no unanimity)',
  }))

  return buildResult({
    winner: tieRes.winner,
    responses: currentResponses,
    outcome: 'no-consensus',
    scores: currentResponses.map((r) => ({
      memberId: r.memberId,
      score: r.memberId === tieRes.winner.memberId ? 1 : 0,
      reason: r.memberId === tieRes.winner.memberId
        ? 'Tiebreaker winner'
        : 'Disagreed',
    })),
    votes,
    tiebreaker: { kind: tiebreaker, reason: tieRes.reason },
    retries: attempt,
  })
}

function buildConvergePrompt(responses: CouncilResponse[]): string {
  const lines = [
    'The council did not reach unanimous agreement. Please review the answers below and converge on a single answer.',
    '',
    ...responses.map(
      (r) => `${r.memberName} (${r.memberId}):\n${r.content}`,
    ),
    '',
    'Produce your best single-answer response; do not hedge.',
  ]
  return lines.join('\n')
}

type BuildArgs = {
  winner: CouncilResponse
  responses: CouncilResponse[]
  outcome: 'decided' | 'no-consensus'
  scores: ConsensusResult['scores']
  votes: ConsensusVote[]
  tiebreaker?: { kind: ConsensusInput['tiebreaker']; reason: string }
  retries: number
}

function buildResult(args: BuildArgs): ConsensusResult {
  return {
    winner: args.winner,
    responses: args.responses,
    method: 'unanimous',
    scores: args.scores,
    votes: args.votes,
    outcome: args.outcome,
    tiebreaker: args.tiebreaker as ConsensusResult['tiebreaker'],
    retries: args.retries,
    totalCostUSD: args.responses.reduce((s, r) => s + r.costUSD, 0),
    totalLatencyMs: args.responses.length
      ? Math.max(...args.responses.map((r) => r.latencyMs))
      : 0,
  }
}
