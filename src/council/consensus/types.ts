/**
 * Shared types for the consensus module.
 */
import type {
  ConsensusMethod,
  ConsensusResult,
  CouncilMember,
  CouncilResponse,
  TiebreakerMode,
} from '../types.js'
import type { SimilarityContext } from './similarity.js'

export type ConsensusInput = {
  responses: CouncilResponse[]
  members: CouncilMember[]
  method: ConsensusMethod
  tiebreaker: TiebreakerMode
  /** Max retries for unanimous mode (default 2). */
  unanimousMaxRetries: number
  similarity: SimilarityContext
  /**
   * Optional re-run hook. Only unanimous mode uses this; it calls `rerun`
   * when consensus isn't reached and retries remain. Receives a converge
   * prompt and returns a new response set.
   *
   * If absent, unanimous mode falls through to tiebreaker / no-consensus.
   */
  rerun?: (
    convergePrompt: string,
    attempt: number,
  ) => Promise<CouncilResponse[]>
  /**
   * Borda-count second-pass ranker. Given a voter member + list of candidate
   * responses (excluding the voter's own), returns an ordered array of
   * memberIds, highest preference first.
   *
   * If absent, borda-count falls back to a heuristic based on content
   * similarity to each voter's own answer — which is a reasonable
   * "which answer is closest to mine" proxy but NOT true LLM ranking.
   */
  bordaRank?: (
    voter: CouncilMember,
    candidates: CouncilResponse[],
  ) => Promise<string[]>
  /**
   * Emitter for consensus events (retry, no-consensus). Optional.
   */
  emit?: (event: ConsensusLifecycleEvent) => void
}

export type ConsensusLifecycleEvent =
  | { type: 'retry'; attempt: number; reason: string }
  | { type: 'no_consensus'; method: ConsensusMethod; reason: string }

export type { ConsensusResult }
