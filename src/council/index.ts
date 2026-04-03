/**
 * Council Mode — Multi-model orchestration for Void CLI.
 *
 * Run multiple AI models in parallel, compare responses,
 * and select the best via consensus voting.
 *
 * Usage:
 *   /council on          — Activate council with default preset (duo)
 *   /council off         — Deactivate council mode
 *   /council preset duo  — Switch to a preset (duo, trinity, full, open-source)
 *   /council status      — Show current council configuration
 *   /council ask <prompt> — One-shot council query
 */
export { getCouncilConfig, setCouncilConfig, activatePreset, deactivateCouncil, isCouncilActive, addCouncilMember, removeCouncilMember, COUNCIL_PRESETS } from './config.js'
export { runCouncil, queryCouncil } from './orchestrator.js'
export { CouncilDisplay, CouncilStatusLine } from './renderer.js'
export type { CouncilConfig, CouncilMember, CouncilPreset, CouncilResponse, ConsensusResult, ConsensusMethod, CouncilEvent } from './types.js'
