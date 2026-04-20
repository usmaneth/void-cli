/**
 * Tiebreaker resolution — shared helpers used by majority / weighted / borda
 * when multiple candidates tie for the top slot.
 */
import type {
  CouncilMember,
  CouncilResponse,
  TiebreakerMode,
} from '../types.js'

export type TiebreakResolution = {
  winner: CouncilResponse
  reason: string
  retryRequested: boolean
}

/**
 * Given tied candidate response memberIds, resolve to a single winner.
 *
 * - `leader` (default)  — whichever tied response comes first in `members`.
 * - `random`            — uniform random pick among the tied set.
 * - `retry`             — caller should re-run. We still pick a fallback
 *                         winner (leader) so the result is non-null, but
 *                         `retryRequested` is set to true.
 */
export function resolveTie(args: {
  tied: string[]
  responses: CouncilResponse[]
  members: CouncilMember[]
  tiebreaker: TiebreakerMode
}): TiebreakResolution {
  const { tied, responses, members, tiebreaker } = args
  const tiedResponses = responses.filter((r) => tied.includes(r.memberId))
  if (tiedResponses.length === 0) {
    // Defensive: shouldn't happen, but never return undefined.
    return {
      winner: responses[0]!,
      reason: 'No tied responses — fell through to first',
      retryRequested: false,
    }
  }

  const leaderFirst = pickLeader(tiedResponses, members)

  switch (tiebreaker) {
    case 'random': {
      const idx = Math.floor(Math.random() * tiedResponses.length)
      return {
        winner: tiedResponses[idx]!,
        reason: `Random pick from ${tied.length} tied candidates`,
        retryRequested: false,
      }
    }
    case 'retry':
      return {
        winner: leaderFirst,
        reason: `Retry requested — fallback to leader among ${tied.length} tied candidates`,
        retryRequested: true,
      }
    case 'leader':
    default:
      return {
        winner: leaderFirst,
        reason: `Leader tiebreaker — first of ${tied.length} tied candidates in member order`,
        retryRequested: false,
      }
  }
}

/**
 * Given a set of responses, pick whichever comes first in the `members`
 * ordering (i.e., closest to the leader).
 */
export function pickLeader(
  responses: CouncilResponse[],
  members: CouncilMember[],
): CouncilResponse {
  if (responses.length === 0)
    throw new Error('pickLeader: empty response set')
  for (const m of members) {
    const hit = responses.find((r) => r.memberId === m.id)
    if (hit) return hit
  }
  return responses[0]!
}
