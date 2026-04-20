import { SessionManager, SessionStore } from '../../sessions/index.js'
import type { LocalCommandCall } from '../../types/command.js'

// Singletons mirror src/sessions/command.ts so both commands share state.
let _store: SessionStore | null = null
let _manager: SessionManager | null = null

function getManager(): SessionManager {
  if (!_store) _store = new SessionStore()
  if (!_manager) _manager = new SessionManager(_store)
  return _manager
}

/**
 * /uncompact — rollback the last auto-compaction.
 */
export const call: LocalCommandCall = async () => {
  const manager = getManager()
  if (!manager.currentSession) {
    return {
      type: 'text' as const,
      value: 'No active session — nothing to uncompact.',
    }
  }

  const before = manager.currentSession.compactedAt
  const ok = manager.uncompact()
  if (!ok) {
    return {
      type: 'text' as const,
      value: 'No compaction stash found — nothing to restore.',
    }
  }

  const msgCount = manager.getMessages().length
  const at = before ? new Date(before).toLocaleString() : 'unknown'
  return {
    type: 'text' as const,
    value: `Restored pre-compaction messages (was compacted ${at}; ${msgCount} messages).`,
  }
}

/** Exposed for tests that need to inject a fresh store. */
export function __setManagerForTests(m: SessionManager | null): void {
  _manager = m
}
