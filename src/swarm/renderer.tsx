import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { ProgressBar } from '../components/design-system/ProgressBar.js'
import type { SwarmPhase, SwarmState, Workstream, WorkstreamTask } from './types.js'

type SwarmRendererProps = {
  state: SwarmState | null
  workerMessages: Map<string, string>
}

const PHASE_LABELS: Record<SwarmPhase, string> = {
  idle: 'idle',
  decomposing: 'decomposing',
  working: 'building',
  merging: 'merging',
  reviewing: 'reviewing',
  complete: 'complete',
  failed: 'failed',
}

const PHASE_COLORS: Record<SwarmPhase, string> = {
  idle: 'inactive',
  decomposing: 'warning',
  working: 'claude',
  merging: 'merged',
  reviewing: 'suggestion',
  complete: 'success',
  failed: 'error',
}

const MODEL_FALLBACK_COLORS = [
  'claude',
  'suggestion',
  'success',
  'warning',
  'cyan_FOR_SUBAGENTS_ONLY',
  'pink_FOR_SUBAGENTS_ONLY',
] as const

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(4)}`
  if (cost < 0.1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function getModelColor(model: string, index: number): string {
  if (model.startsWith('google/')) return 'success'
  if (model.startsWith('openai/')) return 'suggestion'
  if (model.startsWith('anthropic/') || model.startsWith('claude')) {
    return 'claude'
  }
  return MODEL_FALLBACK_COLORS[index % MODEL_FALLBACK_COLORS.length]!
}

function estimateWorkstreamCost(workstream: Workstream): number {
  const taskWeight = Math.max(1, workstream.tasks.length)
  if (workstream.model.startsWith('google/')) return taskWeight * 0.004
  if (workstream.model.startsWith('openai/')) return taskWeight * 0.006
  if (workstream.model.startsWith('anthropic/') || workstream.model.startsWith('claude')) {
    return taskWeight * 0.008
  }
  return taskWeight * 0.005
}

function getTaskCounts(tasks: WorkstreamTask[]): {
  done: number
  total: number
  inProgress: number
} {
  return tasks.reduce(
    (acc, task) => {
      if (task.status === 'done') acc.done += 1
      if (task.status === 'in-progress') acc.inProgress += 1
      acc.total += 1
      return acc
    },
    { done: 0, total: 0, inProgress: 0 },
  )
}

function getOverallProgress(state: SwarmState): number {
  const allTasks = state.workstreams.flatMap(workstream => workstream.tasks)
  const taskTotal = allTasks.length
  const done = allTasks.filter(task => task.status === 'done').length
  const inProgress = allTasks.filter(task => task.status === 'in-progress').length
  const buildProgress =
    taskTotal === 0 ? 0 : (done + inProgress * 0.35) / Math.max(1, taskTotal)

  switch (state.phase) {
    case 'decomposing':
      return 0.08
    case 'working':
      return 0.1 + buildProgress * 0.72
    case 'merging':
      return 0.88
    case 'reviewing':
      return 0.95
    case 'complete':
      return 1
    case 'failed':
      return Math.max(0.1, 0.1 + buildProgress * 0.6)
    default:
      return 0
  }
}

function getEstimatedTotalCost(state: SwarmState): number {
  const completedEstimate = state.workstreams.reduce((sum, workstream) => {
    if (workstream.status === 'pending') return sum
    return sum + estimateWorkstreamCost(workstream)
  }, 0)
  return Math.max(state.totalCostUSD, completedEstimate)
}

function getTaskIcon(task: WorkstreamTask): { color: string; icon: string } {
  if (task.status === 'done') return { color: 'success', icon: '✓' }
  if (task.status === 'in-progress') return { color: 'warning', icon: '◐' }
  if (task.status === 'failed') return { color: 'error', icon: '✕' }
  return { color: 'inactive', icon: '○' }
}

type WorkerPanelProps = {
  key?: React.Key
  workstream: Workstream
  index: number
  message?: string
}

function WorkerPanel({
  workstream,
  index,
  message,
}: WorkerPanelProps): React.JSX.Element {
  const modelColor = getModelColor(workstream.model, index)
  const statusColor =
    workstream.status === 'done'
      ? 'success'
      : workstream.status === 'failed'
        ? 'error'
        : workstream.status === 'running'
          ? 'warning'
          : 'inactive'
  const counts = getTaskCounts(workstream.tasks)
  const activeTask = workstream.tasks.find(task => task.status === 'in-progress')
  const workerCost = workstream.status === 'pending' ? 0 : estimateWorkstreamCost(workstream)

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={modelColor}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={modelColor}>
          {workstream.name}
        </Text>
        <Text bold color={statusColor}>
          {workstream.status.toUpperCase()}
        </Text>
      </Box>
      <Text dimColor>
        {workstream.domain} · {workstream.model} · {counts.done}/{counts.total} tasks · est.{' '}
        {formatUSD(workerCost)}
      </Text>
      <Text wrap="truncate-end" dimColor>
        {message ?? workstream.description}
      </Text>
      {activeTask?.file && (
        <Text dimColor wrap="truncate-end">
          Active file: {activeTask.file}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {workstream.tasks.map(task => {
          const { color, icon } = getTaskIcon(task)
          return (
            <Text key={`${workstream.id}-${task.description}`} color={color} wrap="truncate-end">
              {icon} <Text color={undefined}>{task.description}</Text>
              {task.file ? <Text dimColor>{` (${task.file})`}</Text> : null}
            </Text>
          )
        })}
      </Box>
    </Box>
  )
}

export function SwarmRenderer({
  state,
  workerMessages,
}: SwarmRendererProps): React.JSX.Element {
  const { columns } = useTerminalSize()

  if (!state) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Initializing swarm...</Text>
      </Box>
    )
  }

  const progress = getOverallProgress(state)
  const progressPct = Math.round(progress * 100)
  const progressWidth = Math.max(20, Math.min(columns - 28, 48))
  const elapsed = formatDuration(Date.now() - state.startTime)
  const estimatedCost = getEstimatedTotalCost(state)
  const doneWorkers = state.workstreams.filter(workstream => workstream.status === 'done').length

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="claude">
          SWARM
        </Text>
        <Text bold color={PHASE_COLORS[state.phase]}>
          {PHASE_LABELS[state.phase].toUpperCase()}
        </Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        Coordinator {state.config.coordinator} · {state.workstreams.length} workers · elapsed {elapsed}
      </Text>
      <Text dimColor wrap="truncate-end">
        {state.config.description}
      </Text>
      <Box marginTop={1}>
        <ProgressBar
          ratio={progress}
          width={progressWidth}
          fillColor={PHASE_COLORS[state.phase]}
          emptyColor="inactive"
        />
        <Text> </Text>
        <Text bold color={PHASE_COLORS[state.phase]}>
          {progressPct}%
        </Text>
      </Box>
      <Text dimColor>
        {doneWorkers}/{state.workstreams.length} workers finished · est. cost {formatUSD(estimatedCost)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {state.workstreams.map((workstream, index) => (
          <WorkerPanel
            key={workstream.id}
            workstream={workstream}
            index={index}
            message={workerMessages.get(workstream.id)}
          />
        ))}
      </Box>
      <Text dimColor>
        Phases: decomposing → building → merging → reviewing
      </Text>
    </Box>
  )
}

export default SwarmRenderer
