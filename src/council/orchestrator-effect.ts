/**
 * Effect-backed council orchestrator (feature-flagged).
 *
 * Composes Config/Auth/Provider/Permission layers and runs all members in
 * parallel via Effect.all. Keeps the same public surface as the legacy
 * orchestrator: `runCouncilEffect` yields CouncilEvent, `queryCouncilEffect`
 * returns the final ConsensusResult.
 *
 * Activate with `VOID_EFFECT_COUNCIL=1`. The legacy promise-based orchestrator
 * (`orchestrator.ts`) is kept intact for fallback.
 */
import { Effect, Layer, ManagedRuntime } from 'effect'
import type {
  ConsensusMethod,
  ConsensusResult,
  CouncilConfig,
  CouncilEvent,
  CouncilMember,
  CouncilResponse,
} from './types.js'
import { getCouncilConfig } from './config.js'
import {
  Config as ConfigService,
  Provider as ProviderService,
  Permission as PermissionService,
  CouncilLayer as DefaultCouncilLayer,
} from './layers/index.js'

/**
 * Same rough per-million-token pricing used by the legacy orchestrator.
 * Kept local so the pricing table lives with the orchestrator logic.
 */
function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const PRICING: Record<string, { input: number; output: number }> = {
    'anthropic/claude-opus-4': { input: 15, output: 75 },
    'anthropic/claude-sonnet-4': { input: 3, output: 15 },
    'anthropic/claude-haiku-4': { input: 0.8, output: 4 },
    'openai/gpt-4o': { input: 2.5, output: 10 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
    'google/gemini-2.5-pro-preview': { input: 1.25, output: 10 },
    'meta-llama/llama-4-maverick': { input: 0.5, output: 1.5 },
    'qwen/qwen3-235b-a22b': { input: 0.8, output: 2 },
    'deepseek/deepseek-chat-v3-0324': { input: 0.5, output: 1.5 },
  }
  const pricing = PRICING[model] ?? { input: 1, output: 3 }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

function determineConsensus(
  responses: CouncilResponse[],
  members: CouncilMember[],
  method: ConsensusMethod,
): ConsensusResult {
  if (responses.length === 0)
    throw new Error('No responses to determine consensus from')

  let winner: CouncilResponse
  const scores: ConsensusResult['scores'] = []

  switch (method) {
    case 'leader-picks':
      winner = responses[0]!
      for (const r of responses)
        scores.push({
          memberId: r.memberId,
          score: r === winner ? 1 : 0.5,
          reason: r === winner ? 'Leader selection' : 'Alternative perspective',
        })
      break
    case 'voting':
      for (const r of responses) {
        const member = members.find((m) => m.id === r.memberId)
        const weight = member?.weight ?? 1
        const lengthScore = Math.min(r.content.length / 2000, 1)
        scores.push({
          memberId: r.memberId,
          score: lengthScore * weight,
          reason: `Weight: ${weight}, Length: ${r.content.length}`,
        })
      }
      scores.sort((a, b) => b.score - a.score)
      winner = responses.find((r) => r.memberId === scores[0]!.memberId)!
      break
    case 'longest':
      responses.sort((a, b) => b.content.length - a.content.length)
      winner = responses[0]!
      for (const r of responses)
        scores.push({
          memberId: r.memberId,
          score: r.content.length,
          reason: `${r.content.length} chars`,
        })
      break
    case 'first':
      responses.sort((a, b) => a.latencyMs - b.latencyMs)
      winner = responses[0]!
      for (const r of responses)
        scores.push({
          memberId: r.memberId,
          score: 1 / Math.max(r.latencyMs, 1),
          reason: `${r.latencyMs}ms`,
        })
      break
    default:
      winner = responses[0]!
  }

  const totalCostUSD = responses.reduce((s, r) => s + r.costUSD, 0)
  const totalLatencyMs = Math.max(...responses.map((r) => r.latencyMs))
  return {
    winner,
    responses,
    method,
    scores,
    totalCostUSD,
    totalLatencyMs,
  }
}

/** Result of a single member execution used internally by the orchestrator. */
type MemberOutcome =
  | { kind: 'ok'; member: CouncilMember; response: CouncilResponse }
  | { kind: 'err'; member: CouncilMember; error: string }

/**
 * Run one member as an Effect with built-in timeout and permission gating.
 */
function runMemberEffect(
  member: CouncilMember,
  prompt: string,
  systemPrompt: string | undefined,
  timeoutMs: number,
) {
  return Effect.gen(function* () {
    const permission = yield* PermissionService
    const provider = yield* ProviderService

    const decision = yield* permission.check({
      memberId: member.id,
      model: member.model,
      prompt,
    })
    if (decision.kind === 'deny') {
      return {
        kind: 'err',
        member,
        error: `Permission denied: ${decision.reason}`,
      } satisfies MemberOutcome
    }

    const start = Date.now()
    const exec = provider
      .execute({ member, prompt, systemPrompt })
      .pipe(Effect.timeout(timeoutMs))

    const result = yield* Effect.either(exec)
    const latencyMs = Date.now() - start

    if (result._tag === 'Left') {
      const err = result.left
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as any).message)
          : String(err)
      return {
        kind: 'err',
        member,
        error: msg || `Timeout after ${timeoutMs}ms`,
      } satisfies MemberOutcome
    }

    const out = result.right
    const response: CouncilResponse = {
      memberId: member.id,
      memberName: member.name,
      model: member.model,
      content: out.content,
      rawText: out.content,
      toolUses: [],
      latencyMs,
      tokens: out.tokens,
      costUSD: estimateCost(member.model, out.tokens.input, out.tokens.output),
    }
    return { kind: 'ok', member, response } satisfies MemberOutcome
  })
}

/**
 * Core orchestration effect — pulls config from the layer, runs all members in
 * parallel, and returns { members, outcomes, consensusMethod }.
 *
 * Accepts an optional `configOverride` that's merged over what ConfigService
 * returns — matches the legacy orchestrator's signature.
 */
function orchestrateEffect(
  prompt: string,
  systemPrompt: string | undefined,
  configOverride: Partial<CouncilConfig> | undefined,
) {
  return Effect.gen(function* () {
    const configService = yield* ConfigService
    const baseConfig = yield* configService.get()
    const config: CouncilConfig = { ...baseConfig, ...(configOverride ?? {}) }
    const { members, consensusMethod, memberTimeoutMs } = config

    const outcomes = yield* Effect.all(
      members.map((m) =>
        runMemberEffect(m, prompt, systemPrompt, memberTimeoutMs),
      ),
      { concurrency: 'unbounded' },
    )

    return { members, outcomes, consensusMethod }
  })
}

/**
 * Build a ManagedRuntime for the council. Consumers can pass a custom layer
 * (e.g., from tests) or default to the production composition.
 */
export function makeCouncilRuntime(
  layer: Layer.Layer<
    ConfigService | ProviderService | PermissionService,
    never,
    never
  > = DefaultCouncilLayer as any,
) {
  return ManagedRuntime.make(layer)
}

export type CouncilRuntime = ReturnType<typeof makeCouncilRuntime>

/**
 * Async-generator adapter — matches the legacy `runCouncil` signature.
 *
 * Runs the orchestration effect, then yields the same sequence of
 * CouncilEvents the legacy orchestrator produces, so UI code keeps working.
 */
export async function* runCouncilEffect(
  prompt: string,
  systemPrompt?: string,
  configOverride?: Partial<CouncilConfig>,
  runtime?: CouncilRuntime,
): AsyncGenerator<CouncilEvent> {
  const ownsRuntime = !runtime
  const rt = runtime ?? makeCouncilRuntime()
  try {
    // We can't easily stream intermediate events out of Effect.all, so we
    // emit the deterministic start events up-front, await the batch, then
    // emit completion events. Matches legacy semantics closely enough for the
    // current UI (which only paints member_complete / member_error at end).
    const config = { ...getCouncilConfig(), ...(configOverride ?? {}) }
    yield { type: 'council_start', members: config.members }
    for (const m of config.members)
      yield { type: 'member_start', memberId: m.id }

    const { members, outcomes, consensusMethod } = await rt.runPromise(
      orchestrateEffect(prompt, systemPrompt, configOverride),
    )

    const responses: CouncilResponse[] = []
    for (const o of outcomes) {
      if (o.kind === 'ok') {
        responses.push(o.response)
        yield { type: 'member_complete', memberId: o.member.id, response: o.response }
      } else {
        yield { type: 'member_error', memberId: o.member.id, error: o.error }
      }
    }

    if (responses.length === 0)
      throw new Error('All council members failed to respond')

    yield { type: 'consensus_start', method: consensusMethod }
    const result = determineConsensus(responses, members, consensusMethod)
    yield { type: 'consensus_complete', result }
    yield { type: 'council_complete', result }
  } finally {
    if (ownsRuntime) await rt.dispose().catch(() => {})
  }
}

/**
 * Promise adapter — matches the legacy `queryCouncil` signature.
 */
export async function queryCouncilEffect(
  prompt: string,
  systemPrompt?: string,
  configOverride?: Partial<CouncilConfig>,
  runtime?: CouncilRuntime,
): Promise<ConsensusResult> {
  let final: ConsensusResult | undefined
  for await (const event of runCouncilEffect(
    prompt,
    systemPrompt,
    configOverride,
    runtime,
  )) {
    if (event.type === 'council_complete') final = event.result
  }
  if (!final) throw new Error('Council did not produce a result')
  return final
}
