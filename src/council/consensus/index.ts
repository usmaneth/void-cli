/**
 * Council consensus — public entrypoint.
 *
 * Dispatches a `ConsensusInput` to the correct mode implementation and
 * returns the resulting `ConsensusResult`.
 *
 * Mode catalog:
 *   - `leader-picks`        — first member wins (no vote).
 *   - `majority`            — plurality of similar answers wins.
 *   - `weighted-majority`   — plurality with `member.weight` multipliers.
 *   - `unanimous`           — all answered members must agree; re-runs if not.
 *   - `borda-count`         — ranked 2nd-pass scoring.
 *
 * Legacy modes (`voting` / `longest` / `first`) are kept in the orchestrator
 * for the non-Effect path; they're not routed through this module.
 */
import type {
  ConsensusMethod,
  ConsensusResult,
  CouncilMember,
  CouncilResponse,
  TiebreakerMode,
} from '../types.js'
import { resolveSimilarityContext, type SimilarityContext } from './similarity.js'
import type { ConsensusInput, ConsensusLifecycleEvent } from './types.js'
import { runLeaderPicks } from './modes/leader-picks.js'
import { runMajority } from './modes/majority.js'
import { runWeightedMajority } from './modes/weighted-majority.js'
import { runUnanimous } from './modes/unanimous.js'
import { runBordaCount } from './modes/borda-count.js'

export type RunConsensusOptions = {
  method: ConsensusMethod
  responses: CouncilResponse[]
  members: CouncilMember[]
  tiebreaker?: TiebreakerMode
  unanimousMaxRetries?: number
  similarity?: SimilarityContext
  rerun?: ConsensusInput['rerun']
  bordaRank?: ConsensusInput['bordaRank']
  emit?: (event: ConsensusLifecycleEvent) => void
}

/**
 * Default tiebreaker. Exported so callers (config schema, renderer)
 * share the same default.
 */
export const DEFAULT_TIEBREAKER: TiebreakerMode = 'leader'

/** Default retry count for unanimous mode. */
export const DEFAULT_UNANIMOUS_MAX_RETRIES = 2

export async function runConsensus(
  opts: RunConsensusOptions,
): Promise<ConsensusResult> {
  const input: ConsensusInput = {
    responses: opts.responses,
    members: opts.members,
    method: opts.method,
    tiebreaker: opts.tiebreaker ?? DEFAULT_TIEBREAKER,
    unanimousMaxRetries:
      opts.unanimousMaxRetries ?? DEFAULT_UNANIMOUS_MAX_RETRIES,
    similarity: resolveSimilarityContext(opts.similarity),
    rerun: opts.rerun,
    bordaRank: opts.bordaRank,
    emit: opts.emit,
  }

  switch (opts.method) {
    case 'leader-picks':
      return runLeaderPicks(input)
    case 'majority':
      return runMajority(input)
    case 'weighted-majority':
      return runWeightedMajority(input)
    case 'unanimous':
      return runUnanimous(input)
    case 'borda-count':
      return runBordaCount(input)
    default:
      throw new Error(
        `runConsensus: unsupported method "${opts.method}" — use the legacy orchestrator for voting/longest/first`,
      )
  }
}

export {
  runLeaderPicks,
  runMajority,
  runWeightedMajority,
  runUnanimous,
  runBordaCount,
}
export type { ConsensusInput, ConsensusLifecycleEvent } from './types.js'
export type { SimilarityContext } from './similarity.js'
