import type { Command } from '../types/command.js'
import type { LocalCommandCall, LocalCommandResult } from '../types/command.js'
import { getForkManager } from './index.js'

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

const forkCommand = {
  type: 'local',
  name: 'vfork',
  description: 'Branch conversations from any point',
  argumentHint: '[turn_number] | <list|switch|diff|delete|label> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default forkCommand

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

function getSessionId(context: Parameters<LocalCommandCall>[1]): string {
  // Try to derive a session ID from the context. Fall back to a fixed default
  // so the manager always has *something* to key on.
  const appState = context.getAppState?.()
  const sessionId =
    (appState as any)?.sessionId ??
    (appState as any)?.session?.id ??
    'default-session'
  return String(sessionId)
}

// ---------------------------------------------------------------------------
// call — main entry point for the /vfork command
// ---------------------------------------------------------------------------

export const call: LocalCommandCall = async (
  args: string,
  context,
): Promise<LocalCommandResult> => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] ?? ''

  const manager = getForkManager()

  // Ensure initialized
  const sessionId = getSessionId(context)
  manager.init(sessionId)

  // /vfork list
  if (subcommand === 'list') {
    return handleList(manager)
  }

  // /vfork switch <id>
  if (subcommand === 'switch') {
    const id = parts[1]
    if (!id) {
      return text('Usage: /vfork switch <fork-id>')
    }
    return handleSwitch(manager, id)
  }

  // /vfork diff <id1> <id2>
  if (subcommand === 'diff') {
    const id1 = parts[1]
    const id2 = parts[2]
    if (!id1 || !id2) {
      return text('Usage: /vfork diff <fork-id-1> <fork-id-2>')
    }
    return handleDiff(manager, id1, id2)
  }

  // /vfork delete <id>
  if (subcommand === 'delete') {
    const id = parts[1]
    if (!id) {
      return text('Usage: /vfork delete <fork-id>')
    }
    return handleDelete(manager, id)
  }

  // /vfork label <id> <label...>
  if (subcommand === 'label') {
    const id = parts[1]
    const label = parts.slice(2).join(' ')
    if (!id || !label) {
      return text('Usage: /vfork label <fork-id> <label text>')
    }
    return handleLabel(manager, id, label)
  }

  // /vfork [turn_number] — create a fork
  // If subcommand is empty, fork from current turn. If it's a number, fork
  // from that turn.
  if (subcommand === '') {
    return handleCreate(manager)
  }

  const turnNum = parseInt(subcommand, 10)
  if (!isNaN(turnNum)) {
    return handleCreate(manager, turnNum)
  }

  return text(
    `Unknown subcommand "${subcommand}". Available: list, switch, diff, delete, label, or a turn number.`,
  )
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleList(
  manager: ReturnType<typeof getForkManager>,
): LocalCommandResult {
  const forks = manager.list()
  if (forks.length === 0) {
    return text('No forks exist yet.')
  }

  const visualization = manager.visualize()
  const header = `Fork tree (${forks.length} node${forks.length === 1 ? '' : 's'}, * = active):\n`
  return text(header + visualization)
}

function handleSwitch(
  manager: ReturnType<typeof getForkManager>,
  id: string,
): LocalCommandResult {
  try {
    const node = manager.switch(id)
    const label = node.label ? ` "${node.label}"` : ''
    return text(
      `Switched to fork-${node.id}${label} (${node.messages.length} messages)`,
    )
  } catch (err: any) {
    return text(`Error: ${err.message}`)
  }
}

function handleDiff(
  manager: ReturnType<typeof getForkManager>,
  id1: string,
  id2: string,
): LocalCommandResult {
  try {
    const result = manager.diff(id1, id2)
    const lines: string[] = [
      `Comparing fork-${id1} vs fork-${id2}:`,
      `  Common messages: ${result.commonCount}`,
      `  fork-${id1} unique: ${result.fork1Only.length} message${result.fork1Only.length === 1 ? '' : 's'}`,
      `  fork-${id2} unique: ${result.fork2Only.length} message${result.fork2Only.length === 1 ? '' : 's'}`,
    ]

    if (result.fork1Only.length > 0) {
      lines.push('')
      lines.push(`--- fork-${id1} divergent messages ---`)
      for (const msg of result.fork1Only.slice(0, 5)) {
        const role = msg?.role ?? 'unknown'
        const preview = truncate(
          typeof msg?.content === 'string'
            ? msg.content
            : JSON.stringify(msg?.content),
          80,
        )
        lines.push(`  [${role}] ${preview}`)
      }
      if (result.fork1Only.length > 5) {
        lines.push(`  ... and ${result.fork1Only.length - 5} more`)
      }
    }

    if (result.fork2Only.length > 0) {
      lines.push('')
      lines.push(`--- fork-${id2} divergent messages ---`)
      for (const msg of result.fork2Only.slice(0, 5)) {
        const role = msg?.role ?? 'unknown'
        const preview = truncate(
          typeof msg?.content === 'string'
            ? msg.content
            : JSON.stringify(msg?.content),
          80,
        )
        lines.push(`  [${role}] ${preview}`)
      }
      if (result.fork2Only.length > 5) {
        lines.push(`  ... and ${result.fork2Only.length - 5} more`)
      }
    }

    return text(lines.join('\n'))
  } catch (err: any) {
    return text(`Error: ${err.message}`)
  }
}

function handleDelete(
  manager: ReturnType<typeof getForkManager>,
  id: string,
): LocalCommandResult {
  try {
    manager.getTree().deleteFork(id)
    return text(`Deleted fork-${id} and its descendants.`)
  } catch (err: any) {
    return text(`Error: ${err.message}`)
  }
}

function handleLabel(
  manager: ReturnType<typeof getForkManager>,
  id: string,
  label: string,
): LocalCommandResult {
  try {
    manager.getTree().setLabel(id, label)
    return text(`Labeled fork-${id} as "${label}".`)
  } catch (err: any) {
    return text(`Error: ${err.message}`)
  }
}

function handleCreate(
  manager: ReturnType<typeof getForkManager>,
  turnNumber?: number,
): LocalCommandResult {
  try {
    const node = manager.fork(turnNumber)
    const label = node.label ? ` "${node.label}"` : ''
    return text(
      `Created fork-${node.id}${label} from turn ${node.turnNumber}. Use /vfork switch ${node.id} to activate it.`,
    )
  } catch (err: any) {
    return text(`Error: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (!s) return '(empty)'
  if (s.length <= max) return s
  return s.slice(0, max - 3) + '...'
}
