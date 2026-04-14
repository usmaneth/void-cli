import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { ProgressBar } from '../components/design-system/ProgressBar.js'
import type { DeliberationState, ModelResponse } from './types.js'

export type ModelStatus = 'waiting' | 'streaming' | 'done' | 'error'

type DeliberationRendererProps = {
  state: DeliberationState | null
  modelStatuses: Map<string, ModelStatus>
  streamingContent: Map<string, string>
  currentModel: string | null
}

const MODEL_COLORS = [
  'claude',
  'suggestion',
  'success',
  'warning',
  'cyan_FOR_SUBAGENTS_ONLY',
  'pink_FOR_SUBAGENTS_ONLY',
] as const

const STATUS_ICONS: Record<ModelStatus, string> = {
  waiting: '○',
  streaming: '◉',
  done: '●',
  error: '✕',
}

function getModelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length]!
}

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(4)}`
  if (cost < 0.1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

function getConvergenceLabel(state: DeliberationState): {
  color: string
  label: string
} {
  if (state.status === 'converged') {
    return { color: 'success', label: 'converged' }
  }

  const lastRound = state.rounds.at(-1)
  if (lastRound?.converged) {
    return { color: 'success', label: 'aligning' }
  }

  return { color: 'warning', label: 'debating' }
}

function getResponseContext(response: ModelResponse): string {
  if (response.respondingTo.length === 0) return 'initial position'
  if (response.respondingTo.length === 1) {
    return `responding to ${response.respondingTo[0]}`
  }
  return `incorporating ${response.respondingTo.length} models`
}

type ResponseCardProps = {
  key?: React.Key
  response: ModelResponse
  color: string
}

function ResponseCard({
  response,
  color,
}: ResponseCardProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={color}>
          {response.model}
        </Text>
        <Text dimColor>{getResponseContext(response)}</Text>
      </Box>
      <Text dimColor>
        {formatMs(response.latencyMs)} · {formatTokens(response.tokens.input)}↑{' '}
        {formatTokens(response.tokens.output)}↓ · {formatUSD(response.costUSD)}
      </Text>
      <Text wrap="wrap">{response.content}</Text>
    </Box>
  )
}

export function DeliberationRenderer({
  state,
  modelStatuses,
  streamingContent,
  currentModel,
}: DeliberationRendererProps): React.JSX.Element {
  const { columns } = useTerminalSize()

  if (!state) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Initializing deliberation...</Text>
      </Box>
    )
  }

  const progressWidth = Math.max(16, Math.min(columns - 28, 36))
  const roundProgress =
    state.config.maxRounds === 0 ? 0 : state.currentRound / state.config.maxRounds
  const convergence = getConvergenceLabel(state)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          DELIBERATION ROOM
        </Text>
        <Text bold color={convergence.color}>
          {convergence.label.toUpperCase()}
        </Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        Topic: {state.config.topic}
      </Text>
      <Box marginTop={1}>
        <ProgressBar
          ratio={Math.min(1, roundProgress)}
          width={progressWidth}
          fillColor="claude"
          emptyColor="inactive"
        />
        <Text> </Text>
        <Text bold>
          Round {Math.max(1, state.currentRound)}/{state.config.maxRounds}
        </Text>
      </Box>
      <Text dimColor>
        {state.config.models.length} models · total cost {formatUSD(state.totalCostUSD)}
      </Text>
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {state.config.models.map((model, index) => {
          const status = modelStatuses.get(model) ?? 'waiting'
          const color = getModelColor(index)
          return (
            <Text key={model} color={status === 'error' ? 'error' : color}>
              {STATUS_ICONS[status]} <Text bold color={color}>{model}</Text>
              <Text dimColor>{` · ${status}`}</Text>
            </Text>
          )
        })}
      </Box>

      {state.rounds.map(round => (
        <Box key={`round-${round.number}`} flexDirection="column">
          <Box marginBottom={1}>
            <Text bold dimColor>
              Round {round.number}
            </Text>
            {round.converged ? (
              <Text bold color="success">
                {' '}· convergence detected
              </Text>
            ) : null}
          </Box>
          {round.responses.map((response, index) => (
            <ResponseCard
              key={`${round.number}-${response.model}`}
              response={response}
              color={getModelColor(state.config.models.indexOf(response.model) >= 0 ? state.config.models.indexOf(response.model) : index)}
            />
          ))}
        </Box>
      ))}

      {currentModel && streamingContent.has(currentModel) ? (
        <Box flexDirection="column">
          <Text bold dimColor>
            Live response
          </Text>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={getModelColor(state.config.models.indexOf(currentModel))}
            paddingX={1}
          >
            <Box justifyContent="space-between">
              <Text bold color={getModelColor(state.config.models.indexOf(currentModel))}>
                {currentModel}
              </Text>
              <Text bold color="warning">
                STREAMING
              </Text>
            </Box>
            <Text wrap="wrap">{streamingContent.get(currentModel)}</Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}

export default DeliberationRenderer
