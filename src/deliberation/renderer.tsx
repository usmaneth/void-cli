import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import type { DeliberationState, ModelResponse } from './types.js'

export type ModelStatus = 'waiting' | 'streaming' | 'done' | 'error'

type DeliberationRendererProps = {
  state: DeliberationState | null
  modelStatuses: Map<string, ModelStatus>
  streamingContent: Map<string, string>
  currentModel: string | null
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(4)}`
  if (cost < 0.1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Colors ──────────────────────────────────────────────────────────────────

const PALETTE = ['#a78bfa', '#22c55e', '#38bdf8', '#fbbf24', '#f472b6'] as const

function modelColor(index: number): string {
  return PALETTE[index % PALETTE.length]!
}

function convergenceLabel(state: DeliberationState): { color: string; text: string } {
  if (state.status === 'converged') return { color: '#22c55e', text: 'CONVERGED' }
  if (state.status === 'complete') return { color: '#22c55e', text: 'COMPLETE' }
  if (state.status === 'stopped') return { color: '#fbbf24', text: 'STOPPED' }
  const last = state.rounds.at(-1)
  if (last?.converged) return { color: '#22c55e', text: 'ALIGNING' }
  return { color: '#fbbf24', text: 'DEBATING' }
}

// ── Progress bar ────────────────────────────────────────────────────────────

function ProgressText({ ratio, width }: { ratio: number; width: number }): React.JSX.Element {
  const filled = Math.round(ratio * width)
  return (
    <Text>
      <Text color="#7c3aed">{'█'.repeat(filled)}</Text>
      <Text color="#374151">{'░'.repeat(width - filled)}</Text>
    </Text>
  )
}

// ── Response card ───────────────────────────────────────────────────────────

function ResponseCard({
  response,
  color,
  roundNum,
}: {
  key?: React.Key
  response: ModelResponse
  color: string
  roundNum: number
}): React.JSX.Element {
  const ctx = response.respondingTo.length === 0
    ? 'initial position'
    : response.respondingTo.length === 1
      ? `responding to ${response.respondingTo[0]}`
      : `incorporating ${response.respondingTo.length} models`

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text>
        <Text color={color}>{'  ┌ '}</Text>
        <Text bold color={color}>{response.model}</Text>
        <Text dimColor>{' Round '}{roundNum}{' · '}{ctx}</Text>
      </Text>
      <Text>
        <Text color={color}>{'  │ '}</Text>
        <Text dimColor>{formatMs(response.latencyMs)}{' · '}{formatTokens(response.tokens.input)}{'↑ '}{formatTokens(response.tokens.output)}{'↓ · '}{formatUSD(response.costUSD)}</Text>
      </Text>
      {response.content.split('\n').map((line, i) => (
        <Text key={i}>
          <Text color={color}>{'  │ '}</Text>
          <Text wrap="wrap">{line}</Text>
        </Text>
      ))}
      <Text color={color}>{'  └'}</Text>
    </Box>
  )
}

// ── Live streaming card ─────────────────────────────────────────────────────

function StreamingCard({
  model,
  content,
  color,
}: {
  model: string
  content: string
  color: string
}): React.JSX.Element {
  const lines = content.split('\n').slice(-10) // Show last 10 lines
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text>
        <Text color={color}>{'  ┌ '}</Text>
        <Text bold color={color}>{model}</Text>
        <Text bold color="yellow">{' STREAMING'}</Text>
      </Text>
      {lines.map((line, i) => (
        <Text key={i}>
          <Text color={color}>{'  │ '}</Text>
          <Text wrap="wrap">{line}</Text>
        </Text>
      ))}
      <Text>
        <Text color={color}>{'  │ '}</Text>
        <Text color="yellow">{'▌'}</Text>
      </Text>
      <Text color={color}>{'  └'}</Text>
    </Box>
  )
}

// ── Main renderer ───────────────────────────────────────────────────────────

export function DeliberationRenderer({
  state,
  modelStatuses,
  streamingContent,
  currentModel,
}: DeliberationRendererProps): React.JSX.Element {
  const { columns } = useTerminalSize()

  if (!state) {
    return <Box paddingX={1}><Text dimColor>Initializing deliberation...</Text></Box>
  }

  const conv = convergenceLabel(state)
  const roundProgress = state.config.maxRounds === 0
    ? 0
    : state.currentRound / state.config.maxRounds
  const barW = Math.max(16, Math.min(columns - 30, 36))
  const sep = '─'.repeat(Math.max(10, columns - 6))

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="#7c3aed"
      paddingX={1}
      paddingY={0}
      width={columns}
    >
      {/* Title bar */}
      <Box justifyContent="space-between">
        <Text bold color="#7c3aed">{'◈ D E L I B E R A T I O N   R O O M'}</Text>
        <Text bold color={conv.color}>{conv.text}</Text>
      </Box>

      {/* Topic */}
      <Text dimColor wrap="truncate-end">Topic: {state.config.topic}</Text>

      {/* Models + status icons */}
      <Text dimColor>
        Models: {state.config.models.map((m, i) => {
          const status = modelStatuses.get(m) ?? 'waiting'
          const icons: Record<ModelStatus, string> = { waiting: '○', streaming: '◉', done: '●', error: '✕' }
          return `${icons[status]} ${m}`
        }).join(' · ')}
      </Text>

      {/* Round progress */}
      <Box marginTop={0}>
        <Text dimColor>Round </Text>
        <ProgressText ratio={Math.min(1, roundProgress)} width={barW} />
        <Text bold>{' '}{Math.max(1, state.currentRound)}/{state.config.maxRounds}</Text>
      </Box>

      {/* Separator */}
      <Text dimColor>{sep}</Text>

      {/* Completed rounds */}
      {state.rounds.map(round => (
        <Box key={`r-${round.number}`} flexDirection="column">
          <Box>
            <Text bold dimColor>{'Round '}{round.number}</Text>
            {round.converged ? <Text bold color="green">{' · convergence detected'}</Text> : null}
          </Box>
          {round.responses.map((response, ri) => (
            <ResponseCard
              key={`${round.number}-${ri}`}
              response={response}
              color={modelColor(
                state.config.models.indexOf(response.model) >= 0
                  ? state.config.models.indexOf(response.model)
                  : ri
              )}
              roundNum={round.number}
            />
          ))}
        </Box>
      ))}

      {/* Live streaming */}
      {currentModel && streamingContent.has(currentModel) ? (
        <StreamingCard
          model={currentModel}
          content={streamingContent.get(currentModel)!}
          color={modelColor(state.config.models.indexOf(currentModel))}
        />
      ) : null}

      {/* Separator + stats */}
      <Text dimColor>{sep}</Text>
      <Text dimColor>
        {state.config.models.length}{' models · total cost '}{formatUSD(state.totalCostUSD)}
      </Text>

      {/* Hotkeys */}
      <Text dimColor>ctrl+c stop · ctrl+s save transcript · enter inject thoughts</Text>
    </Box>
  )
}

export default DeliberationRenderer
