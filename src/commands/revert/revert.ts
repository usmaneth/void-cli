/**
 * /revert command implementation.
 *
 * Calls `revertSession()` from the PR #58 API or `restoreSession()`
 * from services/session/restore.ts when --restore is passed.
 */
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { revertSession } from '../../services/session/api.js'
import { findLastUserMessageId } from '../../services/session/display.js'
import { isSqliteSessionsEnabled } from '../../services/session/index.js'
import { restoreSession } from '../../services/session/restore.js'
import { getCurrentSessionId } from '../fork/sessionContext.js'

type ParsedArgs = {
  messageId: string | null
  restore: boolean
  yes: boolean
}

export function parseRevertArgs(raw: string): ParsedArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const flags = new Set<string>()
  const positional: string[] = []
  for (const t of tokens) {
    if (t.startsWith('--')) flags.add(t.toLowerCase())
    else positional.push(t)
  }
  return {
    messageId: positional[0] ?? null,
    restore: flags.has('--restore') || flags.has('--undo'),
    yes: flags.has('--yes') || flags.has('--force') || flags.has('-y'),
  }
}

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

export const call: LocalCommandCall = async (rawArgs, context) => {
  if (!isSqliteSessionsEnabled()) {
    return text(
      '/revert requires SQLite session storage. Set VOID_USE_SQLITE_SESSIONS=1 and restart to enable it.',
    )
  }

  const args = parseRevertArgs(rawArgs)
  const sessionId = getCurrentSessionId(context)
  if (!sessionId) {
    return text('/revert: no active session found.')
  }

  let anchorId = args.messageId
  if (!anchorId) {
    anchorId = await findLastUserMessageId(sessionId)
    if (!anchorId) {
      return text(
        '/revert: no user messages to anchor on. Pass an explicit messageId.',
      )
    }
  }

  if (args.restore) {
    try {
      const { restoredCount } = await restoreSession(sessionId, anchorId)
      return text(
        `Restored ${restoredCount} message${restoredCount === 1 ? '' : 's'} in session ${sessionId} after anchor ${anchorId}.`,
      )
    } catch (err: any) {
      return text(`/revert --restore failed: ${err?.message ?? String(err)}`)
    }
  }

  // Destructive-feeling action — require explicit confirmation via --yes
  // unless the caller wired in a programmatic confirmBeforeRevert hook
  // (see tests / future interactive UI).
  if (!args.yes) {
    const confirmed = await runConfirmation(context, anchorId)
    if (!confirmed) {
      return text(
        `/revert canceled. Re-run with --yes to skip the prompt, or /revert ${anchorId} --restore to undo after reverting.`,
      )
    }
  }

  try {
    const { revertedCount } = await revertSession(sessionId, anchorId)
    return text(
      `Reverted ${revertedCount} message${revertedCount === 1 ? '' : 's'} in session ${sessionId} after anchor ${anchorId}.\n` +
        `Run /revert ${anchorId} --restore to undo.`,
    )
  } catch (err: any) {
    return text(`/revert failed: ${err?.message ?? String(err)}`)
  }
}

/**
 * Confirmation surface. Real TUIs wire this to a modal dialog; tests
 * inject a programmatic confirmer. When nothing is available we
 * default to canceled — revert is destructive and "fail closed" is
 * the right posture.
 */
async function runConfirmation(
  context: any,
  anchorId: string,
): Promise<boolean> {
  const confirmer =
    context?.confirmBeforeRevert ??
    context?.options?.confirmBeforeRevert ??
    null
  if (typeof confirmer === 'function') {
    try {
      const res = await confirmer({ anchorId })
      return res === true
    } catch {
      return false
    }
  }
  // No confirmer wired and no --yes flag — fail closed with a nudge.
  return false
}
