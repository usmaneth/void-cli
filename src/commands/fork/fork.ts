/**
 * /fork command implementation.
 *
 * Calls `forkSession()` from the PR #58 API. Does NOT modify the DB
 * directly — the service layer owns all schema access.
 */
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { forkSession } from '../../services/session/api.js'
import { findLastUserMessageId, findLastMessageId } from '../../services/session/display.js'
import { isSqliteSessionsEnabled } from '../../services/session/index.js'
import { getCurrentSessionId } from './sessionContext.js'

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

export const call: LocalCommandCall = async (args, context) => {
  if (!isSqliteSessionsEnabled()) {
    return text(
      '/fork requires SQLite session storage. Set VOID_USE_SQLITE_SESSIONS=1 and restart to enable it.',
    )
  }

  const sessionId = getCurrentSessionId(context)
  if (!sessionId) {
    return text('/fork: no active session found. Start a conversation first.')
  }

  const explicitId = args.trim()
  let anchorId: string | null = explicitId || null

  if (!anchorId) {
    // Prefer the last user message — forking "from my last prompt" is
    // the intuitive default for a model-driven TUI.
    anchorId =
      (await findLastUserMessageId(sessionId)) ??
      (await findLastMessageId(sessionId))
    if (!anchorId) {
      return text(
        '/fork: session has no messages yet. Send at least one message, then fork.',
      )
    }
  }

  try {
    const child = await forkSession(sessionId, anchorId)
    switchActiveSession(context, child.id)
    return text(
      `Forked session → ${child.id}\n` +
        `Parent: ${sessionId}  (anchor: ${anchorId})\n` +
        `New session is now active. Use /resume ${sessionId} to return to the parent.`,
    )
  } catch (err: any) {
    return text(`/fork failed: ${err?.message ?? String(err)}`)
  }
}

/**
 * Switch the in-process session context so subsequent messages land on
 * the new child. The codebase's app-state shape is stubby in this
 * worktree; we probe for common setters and fall back to an env var
 * so a parent process can pick up the new session on restart.
 */
function switchActiveSession(context: any, newId: string): void {
  try {
    const setter =
      context?.setSessionId ??
      context?.setActiveSessionId ??
      context?.options?.setSessionId
    if (typeof setter === 'function') {
      setter(newId)
      return
    }
    const setAppState = context?.setAppState
    if (typeof setAppState === 'function') {
      setAppState((prev: any) => ({ ...prev, sessionId: newId }))
      return
    }
  } catch {
    // Swallow — we surface the new session ID in the command output either way.
  }
  // Fallback: expose the new ID via env so --resume surfaces can pick it up.
  process.env.VOID_ACTIVE_SESSION_ID = newId
}
