import type { LocalCommandCall } from '../types/command.js'
import type { LocalCommandResult } from '../commands.js'
import { getCwd } from '../utils/cwd.js'
import { getCheckpointManager } from './index.js'

export const call: LocalCommandCall = async (
  args: string,
  _context,
): Promise<LocalCommandResult> => {
  const manager = getCheckpointManager(getCwd())
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] ?? 'list'

  switch (subcommand) {
    case 'list':
      return handleList(manager)
    case 'diff':
      return handleDiff(manager, parts[1])
    case 'restore':
      return handleRestore(manager, parts[1])
    case 'prune':
      return handlePrune(manager)
    default:
      return {
        type: 'text',
        value: [
          'Usage:',
          '  /checkpoint list            Show recent checkpoints',
          '  /checkpoint diff <id>       Show diff for a checkpoint',
          '  /checkpoint restore <id>    Restore to a checkpoint',
          '  /checkpoint prune           Clean up old checkpoints',
        ].join('\n'),
      }
  }
}

function handleList(
  manager: ReturnType<typeof getCheckpointManager>,
): LocalCommandResult {
  const checkpoints = manager.list()
  if (checkpoints.length === 0) {
    return { type: 'text', value: 'No checkpoints found for this project.' }
  }

  const lines = checkpoints.map(cp => {
    const date = new Date(cp.timestamp)
    const timeStr = date.toLocaleString()
    const filesStr =
      cp.files.length > 0 ? ` (${cp.files.length} file(s))` : ''
    const stashIndicator = cp.stashRef ? '' : ' [no stash]'
    return `  ${cp.id}  ${timeStr}  ${cp.description}${filesStr}${stashIndicator}`
  })

  return {
    type: 'text',
    value: `Checkpoints (${checkpoints.length}):\n${lines.join('\n')}`,
  }
}

function handleDiff(
  manager: ReturnType<typeof getCheckpointManager>,
  checkpointId: string | undefined,
): LocalCommandResult {
  if (!checkpointId) {
    return {
      type: 'text',
      value: 'Usage: /checkpoint diff <id>',
    }
  }
  try {
    const diffOutput = manager.diff(checkpointId)
    return { type: 'text', value: diffOutput }
  } catch (err) {
    return {
      type: 'text',
      value: `Error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function handleRestore(
  manager: ReturnType<typeof getCheckpointManager>,
  checkpointId: string | undefined,
): LocalCommandResult {
  if (!checkpointId) {
    return {
      type: 'text',
      value: 'Usage: /checkpoint restore <id>',
    }
  }
  try {
    manager.restore(checkpointId)
    return {
      type: 'text',
      value: `Restored checkpoint "${checkpointId}" successfully.`,
    }
  } catch (err) {
    return {
      type: 'text',
      value: `Error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function handlePrune(
  manager: ReturnType<typeof getCheckpointManager>,
): LocalCommandResult {
  const removed = manager.prune()
  if (removed === 0) {
    return {
      type: 'text',
      value: 'No old checkpoints to remove.',
    }
  }
  return {
    type: 'text',
    value: `Pruned ${removed} old checkpoint(s).`,
  }
}
