/**
 * /deliberate command — Multi-model Deliberation Room.
 *
 * Usage:
 *   /deliberate <topic>
 *   /deliberate --models claude-sonnet-4-20250514,openai/gpt-4o --rounds 3 <topic>
 *   /deliberate --duo <topic>
 */
import * as React from 'react'
import { useState, useEffect, memo } from 'react'
import { Box, Text } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import type {
  DeliberationConfig,
  DeliberationState,
  ModelResponse,
  Round,
} from '../../deliberation/types.js'
import type { DeliberationCallbacks } from '../../deliberation/engine.js'
import { runDeliberation } from '../../deliberation/engine.js'

// ── Default models for quick presets ────────────────────────────────────────

const DUO_MODELS = [
  'claude-sonnet-4-20250514',
  'openai/gpt-4o',
]

const DEFAULT_MODELS = DUO_MODELS

const DEFAULT_ROUNDS = 5

// ── Model colors for visual distinction ─────────────────────────────────────

const MODEL_COLORS: string[] = [
  'cyan',
  'magenta',
  'yellow',
  'green',
  'blue',
  'red',
]

function getModelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length]!
}

// ── Format helpers ──────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '...'
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

// ── Status indicator ────────────────────────────────────────────────────────

type ModelStatus = 'waiting' | 'streaming' | 'done' | 'error'

const STATUS_ICONS: Record<ModelStatus, string> = {
  waiting: '○',
  streaming: '◉',
  done: '●',
  error: '✗',
}

// ── Deliberation Display Component ──────────────────────────────────────────

interface DeliberationDisplayProps {
  state: DeliberationState | null
  modelStatuses: Map<string, ModelStatus>
  streamingContent: Map<string, string>
  currentModel: string | null
  onDone: LocalJSXCommandOnDone
}

function DeliberationDisplayImpl({
  state,
  modelStatuses,
  streamingContent,
  currentModel,
}: DeliberationDisplayProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const width = Math.min(columns - 4, 100)
  const divider = '\u2500'.repeat(width)

  if (!state) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Initializing deliberation...</Text>
      </Box>
    )
  }

  const { config, rounds, currentRound, status, totalCostUSD } = state

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>{divider}</Text>
        <Box>
          <Text bold color="cyan">
            DELIBERATION ROOM
          </Text>
          <Text dimColor>
            {' \u00b7 '}Round {currentRound}/{config.maxRounds}
            {' \u00b7 '}{config.models.length} models
            {' \u00b7 '}{formatUSD(totalCostUSD)}
          </Text>
          {status !== 'running' && (
            <Text bold color={status === 'converged' ? 'green' : 'yellow'}>
              {' \u00b7 '}{status.toUpperCase()}
            </Text>
          )}
        </Box>
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor wrap="truncate">
            Topic: {truncate(config.topic, width - 10)}
          </Text>
        </Box>
        <Text dimColor>{divider}</Text>
      </Box>

      {/* Model status indicators */}
      <Box flexDirection="column" paddingX={2} marginBottom={0}>
        {config.models.map((model, i) => {
          const ms = modelStatuses.get(model) ?? 'waiting'
          const icon = STATUS_ICONS[ms]
          const color = getModelColor(i)
          return (
            <Box key={model}>
              <Text color={ms === 'error' ? 'red' : ms === 'done' ? 'green' : color}>
                {icon}
              </Text>
              <Text> </Text>
              <Text bold color={color}>
                {model}
              </Text>
              {ms === 'streaming' && (
                <Text dimColor> streaming...</Text>
              )}
            </Box>
          )
        })}
      </Box>

      {/* Completed round responses */}
      {rounds.map((round) => (
        <Box key={round.number} flexDirection="column" paddingX={1}>
          <Box marginTop={1}>
            <Text bold dimColor>
              {'\u2500\u2500\u2500'} Round {round.number} {'\u2500\u2500\u2500'}
            </Text>
            {round.converged && (
              <Text color="green" bold>
                {' '}CONVERGED
              </Text>
            )}
          </Box>
          {round.responses.map((response, ri) => {
            const modelIndex = config.models.indexOf(response.model)
            const color = getModelColor(modelIndex >= 0 ? modelIndex : ri)
            return (
              <Box
                key={`${round.number}-${response.model}`}
                flexDirection="column"
                paddingX={1}
                marginTop={0}
              >
                <Box>
                  <Text bold color={color}>
                    {response.model}
                  </Text>
                  <Text dimColor>
                    {' \u00b7 '}
                    {formatMs(response.latencyMs)}
                    {' \u00b7 '}
                    {formatTokens(response.tokens.input)}{'\u2191'}{' '}
                    {formatTokens(response.tokens.output)}{'\u2193'}
                    {' \u00b7 '}
                    {formatUSD(response.costUSD)}
                  </Text>
                </Box>
                <Box marginLeft={2}>
                  <Text wrap="wrap">
                    {truncate(response.content, width * 6)}
                  </Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      ))}

      {/* Current streaming content */}
      {currentModel && streamingContent.has(currentModel) && (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          <Box>
            <Text bold color={getModelColor(config.models.indexOf(currentModel))}>
              {currentModel}
            </Text>
            <Text dimColor> (streaming)</Text>
          </Box>
          <Box marginLeft={2}>
            <Text wrap="wrap">
              {truncate(streamingContent.get(currentModel) ?? '', width * 3)}
            </Text>
          </Box>
        </Box>
      )}

      {/* Footer on completion */}
      {status !== 'running' && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text dimColor>{divider}</Text>
          <Box>
            <Text bold color="cyan">
              SUMMARY
            </Text>
            <Text dimColor>
              {' \u00b7 '}{rounds.length} round{rounds.length !== 1 ? 's' : ''}
              {' \u00b7 '}{formatUSD(totalCostUSD)} total
              {status === 'converged' && ' \u00b7 Models converged'}
            </Text>
          </Box>
          <Text dimColor>{divider}</Text>
        </Box>
      )}
    </Box>
  )
}

const DeliberationDisplay = memo(DeliberationDisplayImpl)

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
    <DeliberationDisplay
      state={state}
      modelStatuses={modelStatuses}
      streamingContent={streamingContent}
      currentModel={currentModel}
      onDone={onDone}
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
