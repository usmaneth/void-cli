/**
 * Deliberation Engine — the core loop that drives multi-model debate.
 *
 * For each round, every model is called sequentially. Each model receives
 * the full history of prior responses so it can genuinely challenge or
 * build on what others said. Streaming callbacks let the UI update in
 * real-time.
 */

import type {
  DeliberationConfig,
  DeliberationState,
  ModelResponse,
  Round,
  HumanInjection,
} from './types.js'
import {
  getDeliberationSystemPrompt,
  getRoundPrompt,
  checkConvergence,
} from './prompts.js'

// ── Callbacks ────────────────────────────────────────────────────────────────

export interface DeliberationCallbacks {
  onRoundStart?: (round: number, maxRounds: number) => void
  onModelStart?: (model: string, round: number) => void
  onModelChunk?: (model: string, chunk: string) => void
  onModelComplete?: (response: ModelResponse) => void
  onRoundComplete?: (round: Round) => void
  onConverged?: (round: number) => void
  onComplete?: (state: DeliberationState) => void
}

// ── Cost estimation ─────────────────────────────────────────────────────────

/** Per-million-token pricing for common models. */
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic (direct)
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-20250506': { input: 0.8, output: 4 },
  // OpenRouter paths
  'anthropic/claude-opus-4': { input: 15, output: 75 },
  'anthropic/claude-sonnet-4': { input: 3, output: 15 },
  'anthropic/claude-haiku-4': { input: 0.8, output: 4 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4.1': { input: 2, output: 8 },
  'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'google/gemini-2.5-pro-preview': { input: 1.25, output: 10 },
  'google/gemini-2.5-flash-preview': { input: 0.15, output: 0.6 },
  'meta-llama/llama-4-maverick': { input: 0.5, output: 1.5 },
  'deepseek/deepseek-chat-v3-0324': { input: 0.5, output: 1.5 },
  'qwen/qwen3-235b-a22b': { input: 0.8, output: 2 },
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model] ?? { input: 1, output: 3 }
  return (
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  )
}

// ── Model invocation ────────────────────────────────────────────────────────

/**
 * Call a single model with streaming. Uses getAnthropicClient which
 * auto-routes to the correct provider (Anthropic, OpenRouter, etc.)
 * based on the model string.
 */
async function callModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  onChunk?: (chunk: string) => void,
): Promise<{
  content: string
  inputTokens: number
  outputTokens: number
}> {
  const { getAnthropicClient } = await import('../services/api/client.js')
  const client = await getAnthropicClient({ maxRetries: 2, model })

  let content = ''
  let inputTokens = 0
  let outputTokens = 0

  // Use messages.create with stream:true (not messages.stream) for
  // compatibility with the OpenAI shim used by OpenRouter/Gemini/OpenAI
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    stream: true,
  })

  for await (const event of response) {
    if (
      event.type === 'content_block_delta' &&
      'text' in event.delta
    ) {
      const text = (event.delta as any).text as string
      content += text
      onChunk?.(text)
    }
    if (event.type === 'message_start' && (event as any).message?.usage) {
      inputTokens = (event as any).message.usage.input_tokens ?? 0
    }
    if (event.type === 'message_delta' && (event as any).usage) {
      outputTokens = (event as any).usage.output_tokens ?? 0
    }
  }

  return { content, inputTokens, outputTokens }
}

// ── Main deliberation loop ──────────────────────────────────────────────────

/**
 * Run a full deliberation session.
 *
 * @param config  Deliberation configuration (topic, models, rounds, etc.)
 * @param callbacks  UI callbacks for real-time streaming updates
 * @param getHumanInjection  Optional async function called between rounds;
 *   return a string to inject or null/undefined to skip.
 */
export async function runDeliberation(
  config: DeliberationConfig,
  callbacks: DeliberationCallbacks,
  getHumanInjection?: (
    afterRound: number,
  ) => Promise<string | null | undefined>,
): Promise<DeliberationState> {
  const state: DeliberationState = {
    config,
    rounds: [],
    currentRound: 0,
    status: 'running',
    totalCostUSD: 0,
    humanInjections: [],
  }

  // All responses across all rounds (for building context)
  const allResponses: ModelResponse[] = []

  for (let roundNum = 1; roundNum <= config.maxRounds; roundNum++) {
    if (state.status !== 'running') break

    state.currentRound = roundNum
    callbacks.onRoundStart?.(roundNum, config.maxRounds)

    const roundResponses: ModelResponse[] = []

    // Find the human injection for this round (if any)
    const injection = state.humanInjections.find(
      (h) => h.afterRound === roundNum - 1,
    )

    for (const model of config.models) {
      callbacks.onModelStart?.(model, roundNum)
      const startMs = Date.now()

      const systemPrompt = getDeliberationSystemPrompt(
        model,
        config.models.length,
      )

      const contextPrefix = config.context
        ? `Context:\n${config.context}\n\n`
        : ''

      const userPrompt =
        contextPrefix +
        getRoundPrompt(
          roundNum,
          config.maxRounds,
          config.topic,
          allResponses,
          injection?.content,
        )

      try {
        const result = await callModel(
          model,
          systemPrompt,
          userPrompt,
          (chunk) => callbacks.onModelChunk?.(model, chunk),
        )

        const cost = estimateCost(model, result.inputTokens, result.outputTokens)
        const latencyMs = Date.now() - startMs

        const response: ModelResponse = {
          model,
          content: result.content,
          round: roundNum,
          respondingTo:
            roundNum === 1
              ? []
              : allResponses
                  .filter((r) => r.round === roundNum - 1)
                  .map((r) => r.model),
          tokens: { input: result.inputTokens, output: result.outputTokens },
          costUSD: cost,
          latencyMs,
        }

        roundResponses.push(response)
        allResponses.push(response)
        state.totalCostUSD += cost
        callbacks.onModelComplete?.(response)
      } catch (err: any) {
        // On error, record a failed response so the UI can show it
        const latencyMs = Date.now() - startMs
        const errorResponse: ModelResponse = {
          model,
          content: `[Error: ${err.message ?? String(err)}]`,
          round: roundNum,
          respondingTo: [],
          tokens: { input: 0, output: 0 },
          costUSD: 0,
          latencyMs,
        }
        roundResponses.push(errorResponse)
        allResponses.push(errorResponse)
        callbacks.onModelComplete?.(errorResponse)
      }
    }

    // Build round object
    const converged =
      config.autoStop && checkConvergence([...state.rounds, { number: roundNum, responses: roundResponses, converged: false }])

    const round: Round = {
      number: roundNum,
      responses: roundResponses,
      converged,
    }

    state.rounds.push(round)
    callbacks.onRoundComplete?.(round)

    // Check convergence
    if (converged) {
      state.status = 'converged'
      callbacks.onConverged?.(roundNum)
      break
    }

    // Request human injection between rounds (not after the final round)
    if (roundNum < config.maxRounds && getHumanInjection) {
      const humanInput = await getHumanInjection(roundNum)
      if (humanInput) {
        const hi: HumanInjection = {
          afterRound: roundNum,
          content: humanInput,
        }
        state.humanInjections.push(hi)
      }
    }
  }

  if (state.status === 'running') {
    state.status = 'complete'
  }

  callbacks.onComplete?.(state)
  return state
}
