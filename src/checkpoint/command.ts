/**
 * /vcheckpoint slash command — workspace checkpointing and rollback.
 */

import type { Command, LocalCommandCall } from '../types/command.js'
import type { LocalCommandResult } from '../types/command.js'
import { getCheckpointManager } from './index.js'

export const call: LocalCommandCall = async (
  args,
  _context,
): Promise<LocalCommandResult> => {
  const manager = getCheckpointManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  switch (sub) {
    case 'create':
      return handleCreate(manager, parts.slice(1).join(' '))
    case 'list':
      return handleList(manager)
    case 'restore':
      return handleRestore(manager, parts[1])
    case 'undo':
      return handleUndo(manager)
    case 'diff':
      return handleDiff(manager, parts[1])
    case 'prune':
      return handlePrune(manager, parts[1] ? parseInt(parts[1], 10) : undefined)
    case 'clear':
      return handleClear(manager)
    case '':
      return handleList(manager)
    default:
      return {
        type: 'text',
        value: [
          'Usage:',
          '  /vcheckpoint                     Show recent checkpoints',
          '  /vcheckpoint create <desc>       Create a checkpoint',
          '  /vcheckpoint list                List all checkpoints',
          '  /vcheckpoint restore <id>        Restore to a checkpoint',
          '  /vcheckpoint undo                Restore to previous checkpoint',
          '  /vcheckpoint diff <id>           Show diff from checkpoint to current',
          '  /vcheckpoint prune [max]         Prune old checkpoints',
          '  /vcheckpoint clear               Remove all checkpoints',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleCreate(
  manager: ReturnType<typeof getCheckpointManager>,
  description: string,
): LocalCommandResult {
  if (!description) {
    return { type: 'text', value: 'Usage: /vcheckpoint create <description>' }
  }

  const checkpoint = manager.create(description)
  return {
    type: 'text',
    value: `Checkpoint created: ${checkpoint.id}\n  ${checkpoint.description} (${checkpoint.files.length} file(s))`,
  }
}

function handleList(
  manager: ReturnType<typeof getCheckpointManager>,
): LocalCommandResult {
  const checkpoints = manager.list()
  if (checkpoints.length === 0) {
    return { type: 'text', value: 'No checkpoints found.' }
  }

  const stats = manager.getStats()
  const lines = checkpoints.map(cp => {
    const date = new Date(cp.timestamp)
    const ago = formatAge(Date.now() - date.getTime())
    return `  ${cp.id}  ${ago}  ${cp.description} (${cp.files.length} file(s))`
  })

  return {
    type: 'text',
    value: `Checkpoints (${stats.total}):\n${lines.join('\n')}`,
  }
}

function handleRestore(
  manager: ReturnType<typeof getCheckpointManager>,
  id: string | undefined,
): LocalCommandResult {
  if (!id) {
    return { type: 'text', value: 'Usage: /vcheckpoint restore <id>' }
  }

  const result = manager.restore(id)
  return { type: 'text', value: result.message }
}

function handleUndo(
  manager: ReturnType<typeof getCheckpointManager>,
): LocalCommandResult {
  const result = manager.undo()
  return { type: 'text', value: result.message }
}

function handleDiff(
  manager: ReturnType<typeof getCheckpointManager>,
  id: string | undefined,
): LocalCommandResult {
  if (!id) {
    return { type: 'text', value: 'Usage: /vcheckpoint diff <id>' }
  }

  const output = manager.diff(id)
  return { type: 'text', value: output }
}

function handlePrune(
  manager: ReturnType<typeof getCheckpointManager>,
  max: number | undefined,
): LocalCommandResult {
  const removed = manager.prune(max)
  if (removed === 0) {
    return { type: 'text', value: 'No old checkpoints to remove.' }
  }
  return { type: 'text', value: `Pruned ${removed} old checkpoint(s).` }
}

function handleClear(
  manager: ReturnType<typeof getCheckpointManager>,
): LocalCommandResult {
  const removed = manager.clearAll()
  if (removed === 0) {
    return { type: 'text', value: 'No checkpoints to remove.' }
  }
  return { type: 'text', value: `Removed all ${removed} checkpoint(s).` }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

const vcheckpoint = {
  type: 'local',
  name: 'vcheckpoint',
  description: 'Workspace checkpointing and rollback',
  argumentHint: '<create|list|restore|undo|diff|prune|clear> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default vcheckpoint
