/**
 * `weighted-majority` consensus mode — plurality of semantically-equivalent
 * answers, but each vote is multiplied by the voter's `member.weight`.
 *
 * This is a thin wrapper over `runMajority({ weighted: true })` because the
 * clustering logic is identical — only the per-cluster score differs.
 */
import type { ConsensusResult } from '../../types.js'
import { runMajority } from './majority.js'
import type { ConsensusInput } from '../types.js'

export async function runWeightedMajority(
  input: ConsensusInput,
): Promise<ConsensusResult> {
  return runMajority(input, { weighted: true })
}
