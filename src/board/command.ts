/**
 * /board slash command — live task board with real-time status.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getTaskBoard } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const board = getTaskBoard()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'inspect') {
    const taskId = parts[1]
    if (!taskId) return { type: 'text', value: 'Usage: /board inspect <task_id>' }
    const entry = board.getEntry(taskId)
    if (!entry) return { type: 'text', value: `Task ${taskId} not found.` }
    const lines = [
      `Task ${entry.taskId} — "${entry.instruction}"`,
      `Status: ${entry.status} | Agent: ${entry.agent || '--'} | Workstream: ${entry.workstream}`,
      `Tokens: ${entry.tokenUsage.toLocaleString()} | Duration: ${entry.durationMs > 0 ? (entry.durationMs / 1000).toFixed(1) + 's' : '--'}`,
      `Steps: ${entry.completedSteps}/${entry.steps}`,
      `Started: ${entry.startedAt || '--'}`,
      `Last update: ${entry.lastUpdate || '--'}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'timeline') {
    const limit = parts[1] ? parseInt(parts[1], 10) : 20
    return { type: 'text', value: board.formatTimeline(limit) }
  }

  if (sub === 'metrics') {
    return { type: 'text', value: board.formatMetrics() }
  }

  if (sub === 'filter') {
    const status = parts[1]
    if (!status) return { type: 'text', value: 'Usage: /board filter <status>\nStatuses: running, queued, completed, failed' }
    return { type: 'text', value: board.formatBoard({ status }) }
  }

  // If arg looks like a workstream name, filter by it
  if (sub && !['inspect', 'timeline', 'metrics', 'filter'].includes(sub)) {
    return { type: 'text', value: board.formatBoard({ workstream: sub }) }
  }

  // Default: show full board
  return { type: 'text', value: board.formatBoard() }
}

const board = {
  type: 'local',
  name: 'board',
  description: 'Live task board with real-time status',
  argumentHint: '<inspect|timeline|metrics|filter> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default board
