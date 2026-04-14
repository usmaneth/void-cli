import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import type { SwarmPhase, SwarmState, Workstream, WorkstreamTask } from './types.js'

type SwarmRendererProps = {
  state: SwarmState | null
  workerMessages: Map<string, string>
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatUSD(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(4)}`
  if (cost < 0.1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m === 0 ? `${s}s` : `${m}m ${s % 60}s`
}

// ── Colors ──────────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<SwarmPhase, string> = {
  idle: 'IDLE',
  decomposing: 'DECOMPOSING',
  awaiting_approval: 'AWAITING APPROVAL',
  working: 'BUILDING',
  merging: 'MERGING',
  reviewing: 'REVIEWING',
  complete: 'COMPLETE',
  failed: 'FAILED',
}

function phaseColor(phase: SwarmPhase): string {
  switch (phase) {
    case 'awaiting_approval': return '#fbbf24'
    case 'working': return '#a78bfa'
    case 'merging': return '#fbbf24'
    case 'reviewing': return '#38bdf8'
    case 'complete': return '#22c55e'
    case 'failed': return '#ef4444'
    default: return '#a78bfa'
  }
}

function modelColor(model: string, i: number): string {
  if (model.startsWith('google/')) return '#22c55e'
  if (model.startsWith('openai/')) return '#38bdf8'
  if (model.startsWith('claude') || model.startsWith('anthropic/')) return '#a78bfa'
  const palette = ['#a78bfa', '#38bdf8', '#22c55e', '#fbbf24', '#f472b6'] as const
  return palette[i % palette.length]!
}

function statusArrow(status: string): { icon: string; color: string } {
  switch (status) {
    case 'running': return { icon: '▶', color: 'yellow' }
    case 'done': return { icon: '✓', color: 'green' }
    case 'failed': return { icon: '✕', color: 'red' }
    default: return { icon: '○', color: 'gray' }
  }
}

function taskIcon(task: WorkstreamTask): { ch: string; color: string } {
  switch (task.status) {
    case 'done': return { ch: '●', color: 'green' }
    case 'in-progress': return { ch: '◐', color: 'yellow' }
    case 'failed': return { ch: '✕', color: 'red' }
    default: return { ch: '○', color: 'gray' }
  }
}

// ── Progress bar (pure text, no dependency) ─────────────────────────────────

function ProgressText({ ratio, width }: { ratio: number; width: number }): React.JSX.Element {
  const filled = Math.round(ratio * width)
  const empty = width - filled
  return (
    <Text>
      <Text color="#22c55e">{'█'.repeat(filled)}</Text>
      <Text color="#374151">{'░'.repeat(empty)}</Text>
    </Text>
  )
}

// ── Worker panel ────────────────────────────────────────────────────────────

function WorkerPanel({
  ws,
  index,
  message,
}: {
  key?: React.Key
  ws: Workstream
  index: number
  message?: string
}): React.JSX.Element {
  const color = modelColor(ws.model, index)
  const sa = statusArrow(ws.status)
  const done = ws.tasks.filter(t => t.status === 'done').length
  const branch = ws.worktreeBranch ? `worktree: ${ws.worktreeBranch}` : ''

  return (
    <Box flexDirection="column" marginBottom={0}>
      {/* Header line: ┌ Name → Model   worktree: branch */}
      <Text>
        <Text color={color}>{'  ┌ '}</Text>
        <Text bold color={color}>{ws.name}</Text>
        <Text color={color}>{' → '}</Text>
        <Text color={color}>{ws.model}</Text>
        {branch ? <Text dimColor>{'  '}{branch}</Text> : null}
      </Text>

      {/* Status line */}
      <Text>
        <Text color={color}>{'  │ '}</Text>
        <Text color={sa.color}>{sa.icon}</Text>
        <Text dimColor>{' '}{ws.status.toUpperCase()}{' · '}{done}/{ws.tasks.length} tasks</Text>
        {message ? <Text dimColor>{' · '}{message}</Text> : null}
      </Text>

      {/* Task list */}
      {ws.tasks.map((task, ti) => {
        const ti2 = taskIcon(task)
        return (
          <Text key={`${ws.id}-${ti}`}>
            <Text color={color}>{'  │ '}</Text>
            <Text color={ti2.color}>{ti2.ch}</Text>
            <Text>{' '}{task.description}</Text>
            {task.file ? <Text dimColor>{` (${task.file})`}</Text> : null}
          </Text>
        )
      })}

      {/* Footer */}
      <Text color={color}>{'  └'}</Text>
    </Box>
  )
}

// ── Main renderer ───────────────────────────────────────────────────────────

export function SwarmRenderer({ state, workerMessages }: SwarmRendererProps): React.JSX.Element {
  const { columns } = useTerminalSize()

  if (!state) {
    return <Box paddingX={1}><Text dimColor>Initializing swarm...</Text></Box>
  }

  const allTasks = state.workstreams.flatMap(ws => ws.tasks)
  const totalTasks = allTasks.length
  const doneTasks = allTasks.filter(t => t.status === 'done').length
  const inProgress = allTasks.filter(t => t.status === 'in-progress').length
  const buildRatio = totalTasks === 0 ? 0 : (doneTasks + inProgress * 0.35) / totalTasks

  let ratio = 0
  switch (state.phase) {
    case 'decomposing': ratio = 0.08; break
    case 'awaiting_approval': ratio = 0.1; break
    case 'working': ratio = 0.1 + buildRatio * 0.72; break
    case 'merging': ratio = 0.88; break
    case 'reviewing': ratio = 0.95; break
    case 'complete': ratio = 1; break
    case 'failed': ratio = Math.max(0.1, 0.1 + buildRatio * 0.6); break
  }

  const pct = Math.round(ratio * 100)
  const elapsed = formatDuration(Date.now() - state.startTime)
  const cost = state.workstreams.reduce((sum, ws) => {
    if (ws.status === 'pending') return sum
    const w = Math.max(1, ws.tasks.length)
    if (ws.model.startsWith('google/')) return sum + w * 0.004
    if (ws.model.startsWith('openai/')) return sum + w * 0.006
    if (ws.model.startsWith('claude') || ws.model.startsWith('anthropic/')) return sum + w * 0.008
    return sum + w * 0.005
  }, state.totalCostUSD)
  const doneWorkers = state.workstreams.filter(ws => ws.status === 'done').length
  const barW = Math.max(20, Math.min(columns - 30, 48))
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
        <Text bold color="#7c3aed">{'◈ S W A R M'}</Text>
        <Text bold color={phaseColor(state.phase)}>{PHASE_LABEL[state.phase]}</Text>
      </Box>

      {/* Coordinator + description */}
      <Text dimColor>
        {'Coordinator: '}{state.config.coordinator}{' · '}{state.workstreams.length}{' workers · elapsed '}{elapsed}
      </Text>
      <Text dimColor wrap="truncate-end">{state.config.description}</Text>

      {/* Separator */}
      <Text dimColor>{sep}</Text>

      {/* Worker panels */}
      {state.workstreams.map((ws, i) => (
        <WorkerPanel
          key={ws.id}
          ws={ws}
          index={i}
          message={workerMessages.get(ws.id)}
        />
      ))}

      {/* Separator */}
      <Text dimColor>{sep}</Text>

      {/* Progress bar */}
      <Box>
        <Text dimColor>{'Progress: '}</Text>
        <ProgressText ratio={ratio} width={barW} />
        <Text bold color={phaseColor(state.phase)}>{' '}{pct}%</Text>
      </Box>

      {/* Stats line */}
      <Text dimColor>
        {doneWorkers}/{state.workstreams.length}{' workers finished · Est. cost '}{formatUSD(cost)}{' · Elapsed '}{elapsed}
      </Text>

      {/* Approval prompt */}
      {state.phase === 'awaiting_approval' ? (
        <Box marginTop={1}>
          <Text bold color="#fbbf24">
            {'Press Enter to approve and launch workers, or Ctrl+C to cancel'}
          </Text>
        </Box>
      ) : null}

      {/* Hotkeys */}
      <Text dimColor>
        {state.phase === 'awaiting_approval'
          ? 'enter approve · ctrl+c cancel'
          : 'enter inject guidance · ctrl+c abort · tab switch focus'}
      </Text>
    </Box>
  )
}

export default SwarmRenderer
