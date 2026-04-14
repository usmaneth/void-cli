/**
 * /deliberate command — Multi-model Deliberation Room.
 *
 * Usage:
 *   /deliberate <topic>
 *   /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o --rounds 3 <topic>
 *   /deliberate --duo <topic>
 */
import * as React from 'react'
import { useState, useEffect } from 'react'
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

// ── Default models for quick presets ────────────────────────────────────────

const DUO_MODELS = [
  'claude-sonnet-4-20250514',
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

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  topic: string
  models: string[]
  rounds: number
}

function parseArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/)
  let models = DEFAULT_MODELS
  let rounds = DEFAULT_ROUNDS
  const topicParts: string[] = []
  let isDuo = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '--models' && tokens[i + 1]) {
      models = tokens[i + 1]!.split(',').map((m) => m.trim()).filter(Boolean)
      i++
    } else if (token === '--rounds' && tokens[i + 1]) {
      rounds = Math.max(1, Math.min(20, parseInt(tokens[i + 1]!, 10) || DEFAULT_ROUNDS))
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

  return {
    topic: topicParts.join(' '),
    models,
    rounds,
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
        onDone(
          `Deliberation complete: ${finalState.rounds.length} round(s), ` +
            `${formatUSD(finalState.totalCostUSD)} total, ` +
            `${formatTokens(totalTokens)} tokens, ` +
            `status: ${finalState.status}`,
          { display: 'system' },
        )
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

  if (!parsed.topic) {
    onDone(
      'Usage: /deliberate <topic> [--models m1,m2] [--rounds N] [--duo]\n' +
        '\n' +
        'Examples:\n' +
        '  /deliberate Should we use microservices or a monolith?\n' +
        '  /deliberate --duo What is the best approach to error handling in Rust?\n' +
        '  /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o,google/gemini-2.5-pro-preview --rounds 3 Is TDD worth it?',
      { display: 'system' },
    )
    return null
  }

  const config: DeliberationConfig = {
    topic: parsed.topic,
    models: parsed.models,
    maxRounds: parsed.rounds,
    autoStop: true,
    showTokenUsage: true,
  }

  return <DeliberationRunner config={config} onDone={onDone} />
}
