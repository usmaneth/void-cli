/**
 * Council Orchestrator — runs multiple models in parallel and collects responses.
 *
 * Architecture:
 * - Each council member gets the same prompt
 * - All members query in parallel via Promise.allSettled
 * - Anthropic models use the native SDK, OpenRouter models use the shim
 * - Results are collected, timed, and scored
 * - Consensus is determined by the configured method
 */

import type { CouncilConfig, CouncilEvent, CouncilMember, CouncilResponse, ConsensusResult, ConsensusMethod } from './types.js'
import { getCouncilConfig } from './config.js'

/**
 * Query a single council member with the given prompt.
 * Returns a CouncilResponse with timing and token data.
 */
async function queryMember(
  member: CouncilMember,
  prompt: string,
  systemPrompt?: string,
): Promise<CouncilResponse> {
  const startTime = Date.now()

  let content = ''
  let inputTokens = 0
  let outputTokens = 0

  if (member.provider === 'anthropic') {
    // Use the existing Void API client (handles OAuth, retries, etc.)
    const { getAnthropicClient } = await import('../services/api/client.js')
    const { isClaudeAISubscriber } = await import('../utils/auth.js')
    const { OAUTH_BETA_HEADER } = await import('../constants/oauth.js')
    const client = await getAnthropicClient({ maxRetries: 1 })
    const betas: string[] = []
    if (isClaudeAISubscriber()) {
      betas.push(OAUTH_BETA_HEADER)
    }
    const response = await client.beta.messages.create({
      model: member.model.replace('anthropic/', ''),
      max_tokens: 4096,
      system: systemPrompt || '',
      messages: [{ role: 'user', content: prompt }],
      ...(betas.length > 0 && { betas }),
    })
    content = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    inputTokens = response.usage?.input_tokens ?? 0
    outputTokens = response.usage?.output_tokens ?? 0
  } else {
    // Use OpenRouter via fetch (OpenAI Chat Completions format)
    let apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      // Fallback: read from macOS keychain
      try {
        const { execFileSync } = await import('child_process')
        apiKey = execFileSync('security', ['find-generic-password', '-s', 'Void-openrouter', '-w'], { encoding: 'utf-8' }).trim()
      } catch {}
    }
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set — run /provider add openrouter <key>')

    const baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/usmaneth/void-cli',
        'X-Title': 'Void CLI Council',
      },
      body: JSON.stringify({
        model: member.model,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          { role: 'user' as const, content: prompt },
        ],
        max_tokens: 4096,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any
    content = data.choices?.[0]?.message?.content ?? ''
    inputTokens = data.usage?.prompt_tokens ?? 0
    outputTokens = data.usage?.completion_tokens ?? 0
  }

  const latencyMs = Date.now() - startTime

  // Rough cost estimation
  const costUSD = estimateCost(member.model, inputTokens, outputTokens)

  return {
    memberId: member.id,
    memberName: member.name,
    model: member.model,
    content,
    rawText: content,
    toolUses: [],
    latencyMs,
    tokens: { input: inputTokens, output: outputTokens },
    costUSD,
  }
}

/**
 * Rough cost estimation per model.
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Rough per-million-token pricing
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

/**
 * Determine consensus from multiple responses.
 */
function determineConsensus(
  responses: CouncilResponse[],
  members: CouncilMember[],
  method: ConsensusMethod,
): ConsensusResult {
  if (responses.length === 0) {
    throw new Error('No responses to determine consensus from')
  }

  let winner: CouncilResponse
  const scores: ConsensusResult['scores'] = []

  switch (method) {
    case 'leader-picks':
      // First member (leader) wins by default — in a real implementation,
      // the leader would evaluate other responses
      winner = responses[0]!
      for (const r of responses) {
        scores.push({
          memberId: r.memberId,
          score: r === winner ? 1 : 0.5,
          reason: r === winner ? 'Leader selection' : 'Alternative perspective',
        })
      }
      break

    case 'voting':
      // Weight-based scoring: longer, more detailed responses score higher
      for (const r of responses) {
        const member = members.find(m => m.id === r.memberId)
        const weight = member?.weight ?? 1
        // Score based on response length (normalized) and weight
        const lengthScore = Math.min(r.content.length / 2000, 1)
        const score = lengthScore * weight
        scores.push({
          memberId: r.memberId,
          score,
          reason: `Weight: ${weight}, Length: ${r.content.length}`,
        })
      }
      scores.sort((a, b) => b.score - a.score)
      winner = responses.find(r => r.memberId === scores[0]!.memberId)!
      break

    case 'longest':
      // Simply pick the longest response
      responses.sort((a, b) => b.content.length - a.content.length)
      winner = responses[0]!
      for (const r of responses) {
        scores.push({
          memberId: r.memberId,
          score: r.content.length,
          reason: `${r.content.length} chars`,
        })
      }
      break

    case 'first':
      // Pick the fastest response
      responses.sort((a, b) => a.latencyMs - b.latencyMs)
      winner = responses[0]!
      for (const r of responses) {
        scores.push({
          memberId: r.memberId,
          score: 1 / r.latencyMs,
          reason: `${r.latencyMs}ms`,
        })
      }
      break

    default:
      winner = responses[0]!
      break
  }

  const totalCostUSD = responses.reduce((sum, r) => sum + r.costUSD, 0)
  const totalLatencyMs = Math.max(...responses.map(r => r.latencyMs))

  return {
    winner,
    responses,
    method,
    scores,
    totalCostUSD,
    totalLatencyMs,
  }
}

/**
 * Run the council — query all members in parallel and determine consensus.
 *
 * Yields CouncilEvent objects for real-time UI updates.
 */
export async function* runCouncil(
  prompt: string,
  systemPrompt?: string,
  configOverride?: Partial<CouncilConfig>,
): AsyncGenerator<CouncilEvent> {
  const config = { ...getCouncilConfig(), ...configOverride }
  const { members, consensusMethod, memberTimeoutMs } = config

  yield { type: 'council_start', members }

  // Start all member queries in parallel
  const memberPromises = members.map(async (member): Promise<CouncilResponse> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${memberTimeoutMs}ms`)), memberTimeoutMs)
    })

    return Promise.race([
      queryMember(member, prompt, systemPrompt),
      timeoutPromise,
    ])
  })

  // Yield start events
  for (const member of members) {
    yield { type: 'member_start', memberId: member.id }
  }

  // Collect results as they complete
  const results = await Promise.allSettled(memberPromises)
  const responses: CouncilResponse[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    const member = members[i]!

    if (result.status === 'fulfilled') {
      responses.push(result.value)
      yield { type: 'member_complete', memberId: member.id, response: result.value }
    } else {
      yield {
        type: 'member_error',
        memberId: member.id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      }
    }
  }

  if (responses.length === 0) {
    throw new Error('All council members failed to respond')
  }

  // Determine consensus
  yield { type: 'consensus_start', method: consensusMethod }
  const consensusResult = determineConsensus(responses, members, consensusMethod)
  yield { type: 'consensus_complete', result: consensusResult }
  yield { type: 'council_complete', result: consensusResult }
}

/**
 * Quick council query — runs the council and returns just the final result.
 */
export async function queryCouncil(
  prompt: string,
  systemPrompt?: string,
  configOverride?: Partial<CouncilConfig>,
): Promise<ConsensusResult> {
  let result: ConsensusResult | undefined

  for await (const event of runCouncil(prompt, systemPrompt, configOverride)) {
    if (event.type === 'council_complete') {
      result = event.result
    }
  }

  if (!result) {
    throw new Error('Council did not produce a result')
  }

  return result
}
