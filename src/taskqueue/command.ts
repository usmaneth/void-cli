/**
 * /taskqueue slash command for managing the agent task queue.
 *
 * Usage:
 *   /taskqueue                — show task queue summary (recent 10 tasks)
 *   /taskqueue list [status]  — list tasks filtered by status
 *   /taskqueue inspect <id>   — show detailed step log for a task
 *   /taskqueue stats          — show aggregate statistics
 *   /taskqueue prune [days]   — remove old tasks (default 30 days)
 *   /taskqueue clear          — clear all tasks
 */

import type { Command, LocalCommandCall, LocalCommandResult } from '../types/command.js'
import {
  getTaskQueueManager,
  type TaskStatus,
} from './index.js'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length)
}

function formatTokens(n: number | undefined): string {
  if (n === undefined || n === 0) return '--'
  return n.toLocaleString('en-US')
}

function formatDurationMs(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return '--'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms <= 0) return '--'
  return (ms / 1000).toFixed(1) + 's'
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

const VALID_STATUSES: TaskStatus[] = ['queued', 'running', 'completed', 'failed']

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function showSummary(): LocalCommandResult {
  const mgr = getTaskQueueManager()
  const tasks = mgr.listTasks()

  if (tasks.length === 0) {
    return { type: 'text', value: 'Task queue is empty.' }
  }

  const recent = tasks.slice(-10).reverse()
  const header = `Task Queue (${tasks.length} task${tasks.length === 1 ? '' : 's'}):\n`
  const colHeader =
    '  ' +
    pad('ID', 10) +
    pad('Status', 12) +
    pad('Instruction', 32) +
    pad('Tokens', 10) +
    'Duration'
  const divider = '  ' + '-'.repeat(colHeader.length - 2)

  const rows = recent.map(t => {
    return (
      '  ' +
      pad(t.id, 10) +
      pad(t.status, 12) +
      pad(truncate(t.instruction, 30), 32) +
      pad(formatTokens(t.tokenUsage), 10) +
      formatDurationMs(t.startedAt, t.completedAt)
    )
  })

  return {
    type: 'text',
    value: [header, colHeader, divider, ...rows].join('\n'),
  }
}

function listByStatus(statusArg: string): LocalCommandResult {
  const status = statusArg.toLowerCase() as TaskStatus
  if (!VALID_STATUSES.includes(status)) {
    return {
      type: 'text',
      value: `Invalid status: "${statusArg}". Valid statuses: ${VALID_STATUSES.join(', ')}`,
    }
  }

  const mgr = getTaskQueueManager()
  const tasks = mgr.listTasks(status)

  if (tasks.length === 0) {
    return { type: 'text', value: `No tasks with status "${status}".` }
  }

  const header = `Tasks with status "${status}" (${tasks.length}):\n`
  const colHeader =
    '  ' +
    pad('ID', 10) +
    pad('Instruction', 40) +
    pad('Tokens', 10) +
    'Duration'
  const divider = '  ' + '-'.repeat(colHeader.length - 2)

  const rows = tasks.map(t => {
    return (
      '  ' +
      pad(t.id, 10) +
      pad(truncate(t.instruction, 38), 40) +
      pad(formatTokens(t.tokenUsage), 10) +
      formatDurationMs(t.startedAt, t.completedAt)
    )
  })

  return {
    type: 'text',
    value: [header, colHeader, divider, ...rows].join('\n'),
  }
}

function inspectTaskById(id: string): LocalCommandResult {
  if (!id) {
    return { type: 'text', value: 'Usage: /taskqueue inspect <id>' }
  }

  const mgr = getTaskQueueManager()
  const task = mgr.getTask(id)
  if (!task) {
    return { type: 'text', value: `Task not found: ${id}` }
  }

  const lines: string[] = [
    `Task ${task.id} — ${task.status}`,
    `Instruction: ${task.instruction}`,
    `Tokens: ${formatTokens(task.tokenUsage)}`,
    `Started:   ${task.startedAt ?? '--'}`,
    `Completed: ${task.completedAt ?? '--'}`,
  ]
  if (task.error) {
    lines.push(`Error: ${task.error}`)
  }
  if (task.output) {
    lines.push(`Output: ${truncate(task.output, 200)}`)
  }

  lines.push('', `Steps (${task.steps.length}):`)

  if (task.steps.length === 0) {
    lines.push('  (none)')
  } else {
    for (const s of task.steps) {
      const meta: string[] = []
      if (s.toolName) meta.push(`tool=${s.toolName}`)
      if (s.tokenUsage) meta.push(`tokens=${s.tokenUsage}`)
      if (s.durationMs) meta.push(`${s.durationMs}ms`)
      const metaStr = meta.length > 0 ? ` (${meta.join(', ')})` : ''
      lines.push(
        `  #${s.id} [${s.type}]${metaStr} ${truncate(s.content, 80)}`,
      )
    }
  }

  return { type: 'text', value: lines.join('\n') }
}

function showStats(): LocalCommandResult {
  const mgr = getTaskQueueManager()
  const stats = mgr.getStats()

  if (stats.totalTasks === 0) {
    return { type: 'text', value: 'No tasks recorded yet.' }
  }

  const avgDur =
    stats.avgDurationMs > 0
      ? (stats.avgDurationMs / 1000).toFixed(1) + 's'
      : '--'

  const lines = [
    '=== Task Queue Stats ===',
    `Total tasks:   ${stats.totalTasks}`,
    `  Queued:      ${stats.byStatus.queued}`,
    `  Running:     ${stats.byStatus.running}`,
    `  Completed:   ${stats.byStatus.completed}`,
    `  Failed:      ${stats.byStatus.failed}`,
    '',
    `Total tokens:  ${stats.totalTokens.toLocaleString('en-US')}`,
    `Avg tokens:    ${stats.avgTokens.toLocaleString('en-US')}`,
    `Avg duration:  ${avgDur}`,
    '========================',
  ]

  return { type: 'text', value: lines.join('\n') }
}

function pruneOld(daysArg: string | undefined): LocalCommandResult {
  const days = daysArg ? parseInt(daysArg, 10) : 30
  if (isNaN(days) || days < 0) {
    return {
      type: 'text',
      value: 'Invalid number of days. Usage: /taskqueue prune [days]',
    }
  }

  const mgr = getTaskQueueManager()
  const pruned = mgr.pruneOld(days)
  return {
    type: 'text',
    value:
      pruned > 0
        ? `Pruned ${pruned} task${pruned === 1 ? '' : 's'} older than ${days} day${days === 1 ? '' : 's'}.`
        : `No tasks older than ${days} day${days === 1 ? '' : 's'} found.`,
  }
}

function clearAll(): LocalCommandResult {
  const mgr = getTaskQueueManager()
  const count = mgr.clearAll()
  return {
    type: 'text',
    value:
      count > 0
        ? `Cleared ${count} task${count === 1 ? '' : 's'} from the queue.`
        : 'Task queue was already empty.',
  }
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export const call: LocalCommandCall = async (args: string) => {
  const trimmed = args.trim()

  if (!trimmed) {
    return showSummary()
  }

  const parts = trimmed.split(/\s+/)
  const subcommand = parts[0]!.toLowerCase()
  const rest = parts.slice(1)

  switch (subcommand) {
    case 'list':
      return rest[0] ? listByStatus(rest[0]) : showSummary()
    case 'inspect':
      return inspectTaskById(rest[0] ?? '')
    case 'stats':
      return showStats()
    case 'prune':
      return pruneOld(rest[0])
    case 'clear':
      return clearAll()
    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: "${subcommand}"`,
          '',
          'Usage:',
          '  /taskqueue                — show task queue summary',
          '  /taskqueue list [status]  — list tasks filtered by status',
          '  /taskqueue inspect <id>   — show detailed step log',
          '  /taskqueue stats          — show aggregate statistics',
          '  /taskqueue prune [days]   — remove old tasks (default 30)',
          '  /taskqueue clear          — clear all tasks',
        ].join('\n'),
      }
  }
}

const taskqueue = {
  type: 'local',
  name: 'taskqueue',
  description: 'Manage agent task queue with step logging',
  argumentHint: '<list|inspect|stats|prune|clear> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default taskqueue
