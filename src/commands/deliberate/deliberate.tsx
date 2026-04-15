/**
 * /deliberate command — Multi-model Deliberation Room.
 *
 * Usage:
 *   /deliberate <topic>
 *   /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o --rounds 3 <topic>
 *   /deliberate --duo <topic>
 */
import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useInput } from '../../ink.js'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import type {
  DeliberationConfig,
  DeliberationState,
} from '../../deliberation/types.js'
import type { DeliberationCallbacks } from '../../deliberation/engine.js'
import { runDeliberation } from '../../deliberation/engine.js'
import {
  DeliberationRenderer,
  type ModelStatus,
} from '../../deliberation/renderer.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

// ── Default models for quick presets ────────────────────────────────────────

const DUO_MODELS = [
  'claude-sonnet-4-6',
  'openai/gpt-4o',
]

const DEFAULT_MODELS = DUO_MODELS

const DEFAULT_ROUNDS = 5

// ── Format helpers ──────────────────────────────────────────────────────────

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(5)}`
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Model aliases ───────────────────────────────────────────────────────────
// Maps natural-language model names to their API identifiers.
// Order matters: longer/more-specific patterns must come first so they match
// before shorter ones (e.g. "opus 4.6" before "opus").

const MODEL_ALIASES: Array<{ pattern: RegExp; id: string }> = [
  // Anthropic — Claude
  { pattern: /\bopus\s*4[\.\s]*6\b/i, id: 'claude-opus-4-6' },
  { pattern: /\bsonnet\s*4[\.\s]*6\b/i, id: 'claude-sonnet-4-6' },
  { pattern: /\bhaiku\s*4[\.\s]*5\b/i, id: 'claude-haiku-4-5-20251001' },
  { pattern: /\bopus\s*4\b/i, id: 'claude-opus-4-20250514' },
  { pattern: /\bsonnet\s*4\b/i, id: 'claude-sonnet-4-20250514' },
  { pattern: /\bclaude[\s-]*opus\b/i, id: 'claude-opus-4-6' },
  { pattern: /\bclaude[\s-]*sonnet\b/i, id: 'claude-sonnet-4-6' },
  { pattern: /\bclaude[\s-]*haiku\b/i, id: 'claude-haiku-4-5-20251001' },
  { pattern: /\bopus\b/i, id: 'claude-opus-4-6' },
  { pattern: /\bsonnet\b/i, id: 'claude-sonnet-4-6' },
  { pattern: /\bhaiku\b/i, id: 'claude-haiku-4-5-20251001' },
  // OpenAI
  { pattern: /\bgpt[\s-]*5[\.\s]*4\b/i, id: 'openai/gpt-5.4' },
  { pattern: /\bgpt[\s-]*5[\.\s]*3\b/i, id: 'openai/gpt-5.3' },
  { pattern: /\bgpt[\s-]*5[\.\s]*2\b/i, id: 'openai/gpt-5.2' },
  { pattern: /\bgpt[\s-]*4[\.\s]*1[\s-]*mini\b/i, id: 'openai/gpt-4.1-mini' },
  { pattern: /\bgpt[\s-]*4[\.\s]*1\b/i, id: 'openai/gpt-4.1' },
  { pattern: /\bgpt[\s-]*4[\s-]*o[\s-]*mini\b/i, id: 'openai/gpt-4o-mini' },
  { pattern: /\bgpt[\s-]*4[\s-]*o\b/i, id: 'openai/gpt-4o' },
  { pattern: /\bo3[\s-]*mini\b/i, id: 'openai/o3-mini' },
  { pattern: /\bo3\b/i, id: 'openai/o3' },
  { pattern: /\bo4[\s-]*mini\b/i, id: 'openai/o4-mini' },
  // Google
  { pattern: /\bgemini\s*3[\.\s]*1[\s-]*pro\b/i, id: 'google/gemini-3.1-pro' },
  { pattern: /\bgemini\s*2[\.\s]*5[\s-]*pro\b/i, id: 'google/gemini-2.5-pro-preview' },
  { pattern: /\bgemini\s*2[\.\s]*5[\s-]*flash\b/i, id: 'google/gemini-2.5-flash-preview' },
  { pattern: /\bgemini[\s-]*pro\b/i, id: 'google/gemini-3.1-pro' },
  { pattern: /\bgemini[\s-]*flash\b/i, id: 'google/gemini-2.5-flash-preview' },
  { pattern: /\bgemini\b/i, id: 'google/gemini-3.1-pro' },
  // GLM / Zhipu
  { pattern: /\bglm[\s-]*5[\.\s]*1\b/i, id: 'thudm/glm-5.1' },
  { pattern: /\bglm[\s-]*4\b/i, id: 'thudm/glm-4' },
  { pattern: /\bglm\b/i, id: 'thudm/glm-5.1' },
  // Meta
  { pattern: /\bllama[\s-]*4[\s-]*maverick\b/i, id: 'meta-llama/llama-4-maverick' },
  { pattern: /\bllama[\s-]*4\b/i, id: 'meta-llama/llama-4-maverick' },
  { pattern: /\bmaverick\b/i, id: 'meta-llama/llama-4-maverick' },
  // DeepSeek
  { pattern: /\bdeepseek[\s-]*v3\b/i, id: 'deepseek/deepseek-chat-v3-0324' },
  { pattern: /\bdeepseek[\s-]*r1\b/i, id: 'deepseek/deepseek-r1' },
  { pattern: /\bdeepseek\b/i, id: 'deepseek/deepseek-chat-v3-0324' },
  // Qwen
  { pattern: /\bqwen[\s-]*3\b/i, id: 'qwen/qwen3-235b-a22b' },
  { pattern: /\bqwen\b/i, id: 'qwen/qwen3-235b-a22b' },
  // Mistral
  { pattern: /\bmistral[\s-]*large\b/i, id: 'mistralai/mistral-large' },
  { pattern: /\bmistral\b/i, id: 'mistralai/mistral-large' },
]

/**
 * Try to extract model names from natural language input.
 * Looks for patterns like "use opus and glm 5.1 to debate X"
 * or "have gemini and gpt-4o discuss Y".
 *
 * Returns matched models and the remaining text (the topic).
 */
function extractModelsFromNaturalLanguage(
  input: string,
): { models: string[]; topic: string } | null {
  // Match "use/have/let/with <models> to/about/debate/discuss/on <topic>"
  const connectorPattern = /\b(?:use|have|let|with|get|make|between)\b/i
  const topicSplitter = /\b(?:to\s+(?:debate|discuss|deliberate|argue|talk)|(?:debate|discuss|deliberate|argue)\s+(?:about|on|whether|if)?|(?:about|on|whether|if)\b)/i

  if (!connectorPattern.test(input)) return null

  // Find the topic split point
  const splitMatch = topicSplitter.exec(input)
  if (!splitMatch) return null

  const modelSection = input.slice(0, splitMatch.index)
  const topicSection = input.slice(splitMatch.index + splitMatch[0].length).trim()

  if (!topicSection) return null

  // Extract models from the model section
  const models: string[] = []
  let remaining = modelSection

  for (const alias of MODEL_ALIASES) {
    if (alias.pattern.test(remaining)) {
      if (!models.includes(alias.id)) {
        models.push(alias.id)
        remaining = remaining.replace(alias.pattern, ' ')
      }
    }
  }

  if (models.length === 0) return null

  return { models, topic: topicSection }
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  topic: string
  models: string[]
  rounds: number
  hasModelOverride: boolean
  hasRoundOverride: boolean
  duo: boolean
}

function parseArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/)
  let models = DEFAULT_MODELS
  let rounds = DEFAULT_ROUNDS
  let hasModelOverride = false
  let hasRoundOverride = false
  const topicParts: string[] = []
  let isDuo = false

  // First: check for --flags (they take priority)
  let hasFlags = false
  for (const t of tokens) {
    if (t.startsWith('--')) { hasFlags = true; break }
  }

  if (hasFlags) {
    // Flag-based parsing (original behavior)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      if (token === '--models' && tokens[i + 1]) {
        models = tokens[i + 1]!.split(',').map((m) => m.trim()).filter(Boolean)
        hasModelOverride = true
        i++
      } else if (token === '--rounds' && tokens[i + 1]) {
        rounds = Math.max(1, Math.min(20, parseInt(tokens[i + 1]!, 10) || DEFAULT_ROUNDS))
        hasRoundOverride = true
        i++
      } else if (token === '--duo') {
        isDuo = true
      } else {
        topicParts.push(token)
      }
    }
    if (isDuo) {
      models = DUO_MODELS
    }
  } else {
    // Natural language parsing: try to extract models from conversational input
    const nlResult = extractModelsFromNaturalLanguage(args.trim())
    if (nlResult) {
      models = nlResult.models
      hasModelOverride = true
      topicParts.push(nlResult.topic)
    } else {
      // Fallback: no models detected, entire input is the topic
      topicParts.push(args.trim())
    }
  }

  // Check for round hints in natural language (e.g. "3 rounds", "for 5 rounds")
  if (!hasRoundOverride) {
    const roundMatch = args.match(/\b(\d{1,2})\s*rounds?\b/i)
    if (roundMatch) {
      rounds = Math.max(1, Math.min(20, parseInt(roundMatch[1]!, 10)))
      hasRoundOverride = true
    }
  }

  return {
    topic: topicParts.join(' '),
    models,
    rounds,
    hasModelOverride,
    hasRoundOverride,
    duo: isDuo,
  }
}

// ── Deliberation Runner Component ───────────────────────────────────────────

interface DeliberationRunnerProps {
  config: DeliberationConfig
  onDone: LocalJSXCommandOnDone
}

function DeliberationRunner({
  config,
  onDone,
}: DeliberationRunnerProps): React.ReactNode {
  const [state, setState] = useState<DeliberationState | null>(null)
  const [modelStatuses, setModelStatuses] = useState<Map<string, ModelStatus>>(
    () => new Map(config.models.map((m) => [m, 'waiting' as ModelStatus])),
  )
  const [streamingContent, setStreamingContent] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [currentModel, setCurrentModel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const callbacks: DeliberationCallbacks = {
      onRoundStart(round, maxRounds) {
        if (cancelled) return
        setState((prev) =>
          prev
            ? { ...prev, currentRound: round }
            : {
                config,
                rounds: [],
                currentRound: round,
                status: 'running',
                totalCostUSD: 0,
                humanInjections: [],
              },
        )
        // Reset model statuses for the new round
        setModelStatuses(
          new Map(config.models.map((m) => [m, 'waiting' as ModelStatus])),
        )
        setStreamingContent(new Map())
      },

      onModelStart(model) {
        if (cancelled) return
        setCurrentModel(model)
        setModelStatuses((prev) => {
          const next = new Map(prev)
          next.set(model, 'streaming')
          return next
        })
        setStreamingContent((prev) => {
          const next = new Map(prev)
          next.set(model, '')
          return next
        })
      },

      onModelChunk(model, chunk) {
        if (cancelled) return
        setStreamingContent((prev) => {
          const next = new Map(prev)
          next.set(model, (next.get(model) ?? '') + chunk)
          return next
        })
      },

      onModelComplete(response) {
        if (cancelled) return
        const isError = response.content.startsWith('[Error:')
        setModelStatuses((prev) => {
          const next = new Map(prev)
          next.set(response.model, isError ? 'error' : 'done')
          return next
        })
        setCurrentModel(null)
      },

      onRoundComplete(round) {
        if (cancelled) return
        setState((prev) => {
          if (!prev) return prev
          const totalCost = [...prev.rounds, round].reduce(
            (sum, r) => sum + r.responses.reduce((s, resp) => s + resp.costUSD, 0),
            0,
          )
          return {
            ...prev,
            rounds: [...prev.rounds, round],
            totalCostUSD: totalCost,
          }
        })
        setStreamingContent(new Map())
      },

      onConverged(round) {
        if (cancelled) return
        setState((prev) => (prev ? { ...prev, status: 'converged' } : prev))
      },

      onComplete(finalState) {
        if (cancelled) return
        setState(finalState)
        const totalTokens = finalState.rounds.reduce(
          (sum, r) =>
            sum +
            r.responses.reduce(
              (s, resp) => s + resp.tokens.input + resp.tokens.output,
              0,
            ),
          0,
        )
        // Detect if models failed and surface actionable errors
        const errorModels = new Set<string>()
        for (const r of finalState.rounds) {
          for (const resp of r.responses) {
            if (resp.content.startsWith('[Error:')) {
              errorModels.add(resp.model)
            }
          }
        }
        const allErrors = finalState.rounds.length > 0 && finalState.rounds.every(r =>
          r.responses.every(resp => resp.tokens.output === 0 || resp.content.startsWith('[Error:')),
        )

        let summary =
          `Deliberation complete: ${finalState.rounds.length} round(s), ` +
          `${formatUSD(finalState.totalCostUSD)} total, ` +
          `${formatTokens(totalTokens)} tokens, ` +
          `status: ${finalState.status}`

        if (allErrors) {
          summary +=
            `\n\n⚠ All model calls failed. Check your API keys and auth configuration.` +
            `\nFailing models: ${[...errorModels].join(', ')}` +
            `\nTip: Set ANTHROPIC_API_KEY for Claude models, or use OpenRouter model names (e.g. anthropic/claude-sonnet-4)`
        } else if (errorModels.size > 0) {
          summary += `\n\n⚠ Some models failed: ${[...errorModels].join(', ')}`
        }

        onDone(summary, { display: 'system' })
      },
    }

    // Initialize state
    setState({
      config,
      rounds: [],
      currentRound: 0,
      status: 'running',
      totalCostUSD: 0,
      humanInjections: [],
    })

    runDeliberation(config, callbacks).catch((err) => {
      if (!cancelled) {
        onDone(`Deliberation error: ${err.message ?? String(err)}`, {
          display: 'system',
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+S: save transcript to file
  const stateRef = useRef(state)
  stateRef.current = state

  useInput((_input, key) => {
    if (key.ctrl && _input === 's' && stateRef.current) {
      const s = stateRef.current
      const lines: string[] = [
        `# Deliberation Transcript`,
        `Topic: ${s.config.topic}`,
        `Models: ${s.config.models.join(', ')}`,
        `Status: ${s.status}`,
        `Total cost: $${s.totalCostUSD.toFixed(4)}`,
        '',
      ]
      for (const round of s.rounds) {
        lines.push(`## Round ${round.number}${round.converged ? ' (converged)' : ''}`)
        lines.push('')
        for (const resp of round.responses) {
          lines.push(`### ${resp.model}`)
          lines.push(`_${resp.latencyMs}ms · ${resp.tokens.input}↑ ${resp.tokens.output}↓ · $${resp.costUSD.toFixed(4)}_`)
          lines.push('')
          lines.push(resp.content)
          lines.push('')
        }
      }
      const filename = `deliberation-${Date.now()}.md`
      const dir = join(process.cwd(), '.void')
      void mkdir(dir, { recursive: true }).then(() =>
        writeFile(join(dir, filename), lines.join('\n'))
      )
    }
  })

  return (
    <DeliberationRenderer
      state={state}
      modelStatuses={modelStatuses}
      streamingContent={streamingContent}
      currentModel={currentModel}
    />
  )
}

// ── Command entry point ─────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const parsed = parseArgs(args)
  const settings = getSettingsForSource('userSettings')
  const deliberationSettings = settings?.deliberation

  if (!parsed.topic) {
    onDone(
      'Usage: /deliberate <topic> [--models m1,m2] [--rounds N] [--duo]\n' +
        '\n' +
        'Examples:\n' +
        '  /deliberate Should we use microservices or a monolith?\n' +
        '  /deliberate use opus 4.6 and glm 5.1 to debate whether Rust or Go is better for CLIs\n' +
        '  /deliberate have gemini and gpt 4o discuss the best approach to error handling\n' +
        '  /deliberate --duo What is the best approach to error handling in Rust?\n' +
        '  /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o --rounds 3 Is TDD worth it?',
      { display: 'system' },
    )
    return null
  }

  const config: DeliberationConfig = {
    topic: parsed.topic,
    models:
      parsed.duo || parsed.hasModelOverride
        ? parsed.models
        : (deliberationSettings?.defaultModels?.filter(Boolean) ?? DEFAULT_MODELS),
    maxRounds:
      parsed.hasRoundOverride
        ? parsed.rounds
        : (deliberationSettings?.maxRounds ?? DEFAULT_ROUNDS),
    autoStop: deliberationSettings?.autoStop ?? true,
    showTokenUsage: deliberationSettings?.showTokenUsage ?? true,
  }

  return <DeliberationRunner config={config} onDone={onDone} />
}
