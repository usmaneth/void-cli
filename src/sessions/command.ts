import { writeFileSync } from 'fs'
import { join } from 'path'
import { SessionManager, SessionStore } from './index.js'
import type { LocalCommandCall } from '../types/command.js'

// Singleton store shared across calls
let _store: SessionStore | null = null
function getStore(): SessionStore {
  if (!_store) {
    _store = new SessionStore()
  }
  return _store
}

// Singleton manager shared across calls
let _manager: SessionManager | null = null
function getManager(): SessionManager {
  if (!_manager) {
    _manager = new SessionManager(getStore())
  }
  return _manager
}

/**
 * /session slash command
 *
 * Subcommands:
 *   list                  - show recent sessions
 *   save [name]           - save current session with optional name
 *   resume <id>           - resume a previous session
 *   delete <id>           - delete a session
 *   export <id> [format]  - export as json or markdown
 *   search <query>        - search sessions by title/content
 */
export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]?.toLowerCase() ?? 'list'
  const rest = parts.slice(1).join(' ')

  switch (subcommand) {
    case 'list':
      return handleList()
    case 'save':
      return handleSave(rest || undefined)
    case 'resume':
      return handleResume(rest)
    case 'delete':
      return handleDelete(rest)
    case 'export':
      return handleExport(parts[1], parts[2] as 'json' | 'markdown' | undefined)
    case 'search':
      return handleSearch(rest)
    default:
      return {
        type: 'text' as const,
        value: [
          'Usage: /session <subcommand>',
          '',
          '  list                  Show recent sessions',
          '  save [name]           Save current session with optional name',
          '  resume <id>           Resume a previous session',
          '  delete <id>           Delete a session',
          '  export <id> [format]  Export as json or markdown (default: json)',
          '  search <query>        Search sessions by title/tags',
        ].join('\n'),
      }
  }
}

function handleList() {
  const store = getStore()
  const sessions = store.getRecent(20)

  if (sessions.length === 0) {
    return { type: 'text' as const, value: 'No sessions found.' }
  }

  const lines = ['Recent sessions:', '']
  for (const s of sessions) {
    const date = new Date(s.updatedAt).toLocaleDateString()
    const time = new Date(s.updatedAt).toLocaleTimeString()
    const tags = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : ''
    const shortId = s.id.slice(0, 8)
    lines.push(`  ${shortId}  ${date} ${time}  ${s.title}${tags}  (${s.messageCount} msgs)`)
  }

  return { type: 'text' as const, value: lines.join('\n') }
}

function handleSave(name?: string) {
  const manager = getManager()

  if (!manager.currentSession) {
    return {
      type: 'text' as const,
      value: 'No active session to save. Start a session first.',
    }
  }

  if (name) {
    manager.currentSession.title = name
  }

  const ended = manager.endSession()
  if (!ended) {
    return { type: 'text' as const, value: 'Failed to save session.' }
  }

  return {
    type: 'text' as const,
    value: `Session saved: ${ended.title} (${ended.id.slice(0, 8)})`,
  }
}

function handleResume(sessionId: string) {
  if (!sessionId) {
    return { type: 'text' as const, value: 'Usage: /session resume <id>' }
  }

  const store = getStore()
  const manager = getManager()

  // Support short IDs by finding the first match
  const resolvedId = resolveSessionId(store, sessionId)
  if (!resolvedId) {
    return {
      type: 'text' as const,
      value: `Session not found: ${sessionId}`,
    }
  }

  const meta = manager.resumeSession(resolvedId)
  if (!meta) {
    return {
      type: 'text' as const,
      value: `Failed to load session: ${sessionId}`,
    }
  }

  const messages = manager.getMessages()
  return {
    type: 'text' as const,
    value: `Resumed session: ${meta.title} (${meta.id.slice(0, 8)}) with ${messages.length} messages`,
  }
}

function handleDelete(sessionId: string) {
  if (!sessionId) {
    return { type: 'text' as const, value: 'Usage: /session delete <id>' }
  }

  const store = getStore()
  const resolvedId = resolveSessionId(store, sessionId)
  if (!resolvedId) {
    return {
      type: 'text' as const,
      value: `Session not found: ${sessionId}`,
    }
  }

  const deleted = store.delete(resolvedId)
  return {
    type: 'text' as const,
    value: deleted
      ? `Session deleted: ${resolvedId.slice(0, 8)}`
      : `Failed to delete session: ${sessionId}`,
  }
}

function handleExport(
  sessionId: string | undefined,
  format?: 'json' | 'markdown',
) {
  if (!sessionId) {
    return {
      type: 'text' as const,
      value: 'Usage: /session export <id> [json|markdown]',
    }
  }

  const store = getStore()
  const manager = getManager()
  const resolvedId = resolveSessionId(store, sessionId)
  if (!resolvedId) {
    return {
      type: 'text' as const,
      value: `Session not found: ${sessionId}`,
    }
  }

  const fmt = format === 'markdown' ? 'markdown' : 'json'
  const exported = manager.exportSession(resolvedId, fmt)
  if (!exported) {
    return {
      type: 'text' as const,
      value: `Failed to export session: ${sessionId}`,
    }
  }

  // Write the export to a file in the cwd
  const ext = fmt === 'markdown' ? 'md' : 'json'
  const filename = `session-${resolvedId.slice(0, 8)}.${ext}`
  const outputPath = join(process.cwd(), filename)

  try {
    writeFileSync(outputPath, exported)
    return {
      type: 'text' as const,
      value: `Session exported to ${outputPath}`,
    }
  } catch {
    // If file write fails, return the content directly
    return { type: 'text' as const, value: exported }
  }
}

function handleSearch(query: string) {
  if (!query) {
    return { type: 'text' as const, value: 'Usage: /session search <query>' }
  }

  const store = getStore()
  const results = store.list({ search: query })

  if (results.length === 0) {
    return {
      type: 'text' as const,
      value: `No sessions matching "${query}".`,
    }
  }

  const lines = [`Sessions matching "${query}":`, '']
  for (const s of results) {
    const date = new Date(s.updatedAt).toLocaleDateString()
    const tags = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : ''
    const shortId = s.id.slice(0, 8)
    lines.push(`  ${shortId}  ${date}  ${s.title}${tags}  (${s.messageCount} msgs)`)
  }

  return { type: 'text' as const, value: lines.join('\n') }
}

/**
 * Resolve a potentially-short session ID to a full UUID.
 * Matches against the start of known session IDs.
 */
function resolveSessionId(store: SessionStore, partialId: string): string | null {
  // If it looks like a full UUID, use it directly
  if (partialId.length >= 36) {
    return partialId
  }

  const all = store.list()
  const matches = all.filter(s => s.id.startsWith(partialId))
  if (matches.length === 1) {
    return matches[0]!.id
  }

  // Ambiguous or no match
  return null
}
