/**
 * ConsensusLayer — runs the configured consensus mode against a set of
 * council responses.
 *
 * Mirrors the pattern of the other council layers: a `Context.Tag` with a
 * real default that delegates to `src/council/consensus/`, plus a `mockLayer`
 * for tests.
 *
 * Today only the 5 new modes (`leader-picks`, `majority`, `weighted-majority`,
 * `unanimous`, `borda-count`) are routed through this layer. The legacy
 * `voting` / `longest` / `first` modes stay inline in the orchestrator for
 * backwards compatibility.
 */
import { Context, Effect, Layer } from 'effect'
import type {
  ConsensusMethod,
  ConsensusResult,
  CouncilMember,
  CouncilResponse,
  TiebreakerMode,
} from '../types.js'
import {
  runConsensus,
  type ConsensusInput,
  type ConsensusLifecycleEvent,
} from '../consensus/index.js'
import type { SimilarityContext } from '../consensus/similarity.js'

export type ConsensusRunArgs = {
  method: ConsensusMethod
  responses: CouncilResponse[]
  members: CouncilMember[]
  tiebreaker: TiebreakerMode
  unanimousMaxRetries: number
  similarity?: SimilarityContext
  rerun?: ConsensusInput['rerun']
  bordaRank?: ConsensusInput['bordaRank']
  emit?: (event: ConsensusLifecycleEvent) => void
}

export interface ConsensusService {
  readonly run: (
    args: ConsensusRunArgs,
  ) => Effect.Effect<ConsensusResult, Error>
}

export class Consensus extends Context.Tag('council/Consensus')<
  Consensus,
  ConsensusService
>() {}

/** Default layer — delegates to the real `runConsensus`. */
export const defaultLayer = Layer.succeed(
  Consensus,
  Consensus.of({
    run: (args) =>
      Effect.tryPromise({
        try: () =>
          runConsensus({
            method: args.method,
            responses: args.responses,
            members: args.members,
            tiebreaker: args.tiebreaker,
            unanimousMaxRetries: args.unanimousMaxRetries,
            similarity: args.similarity,
            rerun: args.rerun,
            bordaRank: args.bordaRank,
            emit: args.emit,
          }),
        catch: (err) =>
          err instanceof Error ? err : new Error(String(err)),
      }),
  }),
)

/**
 * Mock layer — caller-supplied result factory. Useful when tests want to
 * verify that the orchestrator plumbed the args correctly without running
 * real clustering.
 */
export const mockLayer = (
  runner: (args: ConsensusRunArgs) => Promise<ConsensusResult> | ConsensusResult,
) =>
  Layer.succeed(
    Consensus,
    Consensus.of({
      run: (args) =>
        Effect.tryPromise({
          try: async () => await runner(args),
          catch: (err) =>
            err instanceof Error ? err : new Error(String(err)),
        }),
    }),
  )
