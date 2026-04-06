import type { Command } from '../types/command.js'
import type { LocalCommandCall, LocalCommandResult } from '../types/command.js'
import {
  formatRelativeTime,
  getDurableExecutionManager,
  truncate,
} from './index.js'

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const durable = {
  type: 'local',
  name: 'durable',
  description: 'Manage durable execution with crash recovery',
  argumentHint: '<list|resume|inspect|cleanup|clear> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default durable

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

export const call: LocalCommandCall = async (
  args,
  _context,
): Promise<LocalCommandResult> => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] ?? ''
  const subArgs = parts.slice(1)

  switch (subcommand) {
    case '':
      return showStatus()
    case 'list':
      return showList()
    case 'resume':
      return resumeExecution(subArgs[0])
    case 'inspect':
      return inspectExecution(subArgs[0])
    case 'complete':
      return completeExecution(subArgs[0])
    case 'cleanup':
      return cleanupExecutions(subArgs[0])
    case 'clear':
      return clearAll()
    default:
      return {
        type: 'text',
        value: `Unknown subcommand: ${subcommand}\nUsage: /durable <list|resume|inspect|complete|cleanup|clear> [args]`,
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function showStatus(): LocalCommandResult {
  const mgr = getDurableExecutionManager()
  const resumable = mgr.getResumable()
  const stats = mgr.getStats()

  if (stats.total === 0) {
    return {
      type: 'text',
      value: 'No durable executions recorded.',
    }
  }

  let out = `Durable Executions (${resumable.length} resumable):\n\n`
  out += formatTable(resumable)
  out += `\nTotal: ${stats.total} | Running: ${stats.running} | Interrupted: ${stats.interrupted} | Completed: ${stats.completed}\n`
  if (resumable.length > 0) {
    out += '\nUse /durable resume [id] to continue from where you left off.'
  }
  return { type: 'text', value: out }
}

function showList(): LocalCommandResult {
  const mgr = getDurableExecutionManager()
  const all = mgr.listExecutions()

  if (all.length === 0) {
    return { type: 'text', value: 'No durable executions recorded.' }
  }

  let out = `All Durable Executions (${all.length}):\n\n`
  out += formatTable(all)
  return { type: 'text', value: out }
}

function resumeExecution(id?: string): LocalCommandResult {
  const mgr = getDurableExecutionManager()

  if (!id) {
    // Resume the most recent resumable execution
    const resumable = mgr.getResumable()
    if (resumable.length === 0) {
      return {
        type: 'text',
        value: 'No interrupted executions to resume.',
      }
    }
    // Sort by lastCheckpoint descending, pick the most recent
    resumable.sort(
      (a, b) =>
        new Date(b.lastCheckpoint).getTime() -
        new Date(a.lastCheckpoint).getTime(),
    )
    id = resumable[0]!.id
  }

  try {
    const { execution, pendingSteps } = mgr.resume(id)
    const completedCount = execution.steps.filter(
      (s) => s.status === 'completed',
    ).length
    let out = `Resumed execution ${id}: ${execution.taskDescription}\n`
    out += `Progress: ${completedCount}/${execution.steps.length} steps completed\n`
    if (pendingSteps.length > 0) {
      out += `\nPending steps:\n`
      for (const step of pendingSteps) {
        out += `  ${step.id}. ${step.description}`
        if (step.toolName) {
          out += ` [${step.toolName}]`
        }
        out += '\n'
      }
    } else {
      out += 'All steps completed. Use /durable complete to finalize.\n'
    }
    return { type: 'text', value: out }
  } catch (err) {
    return {
      type: 'text',
      value: `Error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function inspectExecution(id?: string): LocalCommandResult {
  if (!id) {
    return {
      type: 'text',
      value: 'Usage: /durable inspect <id>',
    }
  }

  const mgr = getDurableExecutionManager()
  const execution = mgr.getExecution(id)
  if (!execution) {
    return { type: 'text', value: `Execution ${id} not found.` }
  }

  let out = `Execution: ${execution.id}\n`
  out += `Task:      ${execution.taskDescription}\n`
  out += `Status:    ${execution.status}\n`
  out += `Started:   ${execution.startedAt}\n`
  out += `Checkpoint: ${execution.lastCheckpoint} (${formatRelativeTime(execution.lastCheckpoint)})\n`
  out += `Steps:     ${execution.currentStep}/${execution.steps.length}\n`

  if (Object.keys(execution.context).length > 0) {
    out += `Context:   ${JSON.stringify(execution.context)}\n`
  }

  out += '\nSteps:\n'
  for (const step of execution.steps) {
    const statusIcon =
      step.status === 'completed'
        ? '[done]'
        : step.status === 'failed'
          ? '[FAIL]'
          : '[    ]'
    out += `  ${statusIcon} ${step.id}. ${step.description}`
    if (step.toolName) {
      out += ` (${step.toolName})`
    }
    if (step.completedAt) {
      out += ` - ${formatRelativeTime(step.completedAt)}`
    }
    out += '\n'
    if (step.status === 'failed' && step.result) {
      out += `         Error: ${step.result}\n`
    }
  }

  return { type: 'text', value: out }
}

function completeExecution(id?: string): LocalCommandResult {
  if (!id) {
    return { type: 'text', value: 'Usage: /durable complete <id>' }
  }
  const mgr = getDurableExecutionManager()
  try {
    mgr.complete(id)
    return { type: 'text', value: `Execution ${id} marked as completed.` }
  } catch (err) {
    return {
      type: 'text',
      value: `Error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function cleanupExecutions(daysArg?: string): LocalCommandResult {
  const days = daysArg ? parseInt(daysArg, 10) : 7
  if (isNaN(days) || days < 0) {
    return { type: 'text', value: 'Invalid number of days.' }
  }
  const mgr = getDurableExecutionManager()
  const removed = mgr.cleanup(days)
  return {
    type: 'text',
    value: `Cleaned up ${removed} execution(s) older than ${days} day(s).`,
  }
}

function clearAll(): LocalCommandResult {
  const mgr = getDurableExecutionManager()
  const removed = mgr.clearAll()
  return {
    type: 'text',
    value: `Cleared ${removed} execution state(s).`,
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTable(
  entries: {
    id: string
    status: string
    taskDescription: string
    stepsCompleted: number
    stepsTotal: number
    lastCheckpoint: string
  }[],
): string {
  if (entries.length === 0) {
    return '  (none)\n'
  }

  const header = `  ${'ID'.padEnd(10)}${'Status'.padEnd(14)}${'Task'.padEnd(30)}${'Steps'.padEnd(10)}Last Checkpoint\n`
  let rows = ''
  for (const e of entries) {
    const task = truncate(e.taskDescription, 27)
    const steps = `${e.stepsCompleted}/${e.stepsTotal}`
    const checkpoint = formatRelativeTime(e.lastCheckpoint)
    rows += `  ${e.id.padEnd(10)}${e.status.padEnd(14)}${task.padEnd(30)}${steps.padEnd(10)}${checkpoint}\n`
  }
  return header + rows
}
