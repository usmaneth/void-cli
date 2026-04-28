import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { getPalette, resolveModelAccent } from '../theme/index.js'
import type { SwarmPhase, SwarmState, Workstream, WorkstreamTask } from './types.js'

type SwarmRendererProps = {
  isConfiguringModels?: boolean
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

function phaseColor(phase: SwarmPhase, palette: ReturnType<typeof getPalette>): string {
  switch (phase) {
    case 'awaiting_approval': return palette.state.warning
    case 'working': return palette.brand.accent
    case 'merging': return palette.state.warning
    case 'reviewing': return palette.brand.diamond
    case 'complete': return palette.state.success
    case 'failed': return palette.state.failure
    default: return palette.brand.accent
  }
}

function modelColor(model: string): string {
  return resolveModelAccent(model)
}

function statusArrow(status: string, palette: ReturnType<typeof getPalette>): { icon: string; color: string } {
  switch (status) {
    case 'running': return { icon: '▶', color: palette.state.warning }
    case 'done': return { icon: '✓', color: palette.state.success }
    case 'failed': return { icon: '✕', color: palette.state.failure }
    default: return { icon: '○', color: palette.text.dim }
  }
}

function taskIcon(task: WorkstreamTask, palette: ReturnType<typeof getPalette>): { ch: string; color: string } {
  switch (task.status) {
    case 'done': return { ch: '●', color: palette.state.success }
    case 'in-progress': return { ch: '◐', color: palette.state.warning }
    case 'failed': return { ch: '✕', color: palette.state.failure }
    default: return { ch: '○', color: palette.text.dim }
  }
}

// ── Progress bar (pure text, no dependency) ─────────────────────────────────

function ProgressText({ ratio, width }: { ratio: number; width: number }): React.JSX.Element {
  const palette = getPalette()
  const filled = Math.round(ratio * width)
  const empty = width - filled
  return (
    <Text>
      <Text color={palette.state.success}>{'█'.repeat(filled)}</Text>
      <Text color={palette.text.dimmer}>{'░'.repeat(empty)}</Text>
    </Text>
  )
}

// ── Worker panel ────────────────────────────────────────────────────────────

function WorkerPanel({
  ws,
  message,
}: {
  key?: React.Key
  ws: Workstream
  index: number
  message?: string
}): React.JSX.Element {
  const palette = getPalette()
  const color = modelColor(ws.model)
  const sa = statusArrow(ws.status, palette)
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
        const ti2 = taskIcon(task, palette)
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

export function SwarmRenderer({
  state,
  workerMessages,
  isConfiguringModels = false,
}: SwarmRendererProps): React.JSX.Element {
  const palette = getPalette()
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
      borderColor={palette.brand.accent}
      paddingX={1}
      paddingY={0}
      width={columns}
    >
      {/* Title bar */}
      <Box justifyContent="space-between">
        <Text bold color={palette.brand.accent}>{'◈ S W A R M'}</Text>
        <Text bold color={phaseColor(state.phase, palette)}>{PHASE_LABEL[state.phase]}</Text>
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
        <Text bold color={phaseColor(state.phase, palette)}>{' '}{pct}%</Text>
      </Box>

      {/* Stats line */}
      <Text dimColor>
        {doneWorkers}/{state.workstreams.length}{' workers finished · Est. cost '}{formatUSD(cost)}{' · Elapsed '}{elapsed}
      </Text>

      {/* Approval prompt */}
      {state.phase === 'awaiting_approval' ? (
        <Box marginTop={1}>
          <Text bold color={palette.state.warning}>
            {isConfiguringModels
              ? 'Set worker model overrides, then press Enter to save them'
              : 'Press Enter to approve, press M to configure models, or Ctrl+C to cancel'}
          </Text>
        </Box>
      ) : null}

      {/* Hotkeys */}
      <Text dimColor>
        {state.phase === 'awaiting_approval'
          ? isConfiguringModels
            ? 'enter save overrides · esc keep current assignments'
            : 'enter approve · m configure models · ctrl+c cancel'
          : 'enter inject guidance · ctrl+c abort · tab switch focus'}
      </Text>
    </Box>
  )
}

export default SwarmRenderer
