/**
 * /compact slash command for manual context window management.
 *
 * Subcommands:
 *   /compact status             - Show current context usage
 *   /compact now                - Force compaction immediately
 *   /compact threshold <percent> - Set auto-compact threshold (1-99)
 */

import {
  AutoCompactManager,
  type AutoCompactStatus,
  type SimpleMessage,
  type UsageLevel,
} from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

function levelIndicator(level: UsageLevel): string {
  switch (level) {
    case 'ok':
      return '[OK]'
    case 'warn':
      return '[WARNING]'
    case 'critical':
      return '[CRITICAL]'
  }
}

function formatStatus(status: AutoCompactStatus): string {
  const lines: string[] = []
  lines.push(`Context window usage: ${levelIndicator(status.level)}`)
  lines.push(
    `  Tokens used : ${status.tokensUsed.toLocaleString()} / ${status.maxTokens.toLocaleString()}`,
  )
  lines.push(`  Usage       : ${formatPercent(status.percent)}`)
  lines.push(`  Level       : ${status.level}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export interface CompactCommandContext {
  /** The manager instance driving this session. */
  manager: AutoCompactManager
  /** Current conversation messages (needed for `/compact now`). */
  getMessages: () => SimpleMessage[]
}

export type CompactCommandResult =
  | { kind: 'status'; text: string }
  | { kind: 'compacted'; summary: string; text: string }
  | { kind: 'threshold_set'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'help'; text: string }

/**
 * Parse and execute a `/compact` subcommand.
 *
 * @param args   The raw argument string after `/compact ` (may be empty).
 * @param ctx    Runtime context providing the manager and message access.
 * @returns      A result object describing what happened.
 */
export function handleCompactCommand(
  args: string,
  ctx: CompactCommandContext,
): CompactCommandResult {
  const trimmed = args.trim()
  const parts = trimmed.split(/\s+/)
  const subcommand = (parts[0] || '').toLowerCase()

  switch (subcommand) {
    // ------------------------------------------------------------------
    // /compact status
    // ------------------------------------------------------------------
    case 'status': {
      const status = ctx.manager.getStatus()
      return { kind: 'status', text: formatStatus(status) }
    }

    // ------------------------------------------------------------------
    // /compact now
    // ------------------------------------------------------------------
    case 'now': {
      const messages = ctx.getMessages()
      if (messages.length === 0) {
        return { kind: 'error', text: 'No messages to compact.' }
      }

      const summary = ctx.manager.generateSummary(messages)
      const status = ctx.manager.getStatus()

      return {
        kind: 'compacted',
        summary,
        text: `Compaction complete. ${formatStatus(status)}`,
      }
    }

    // ------------------------------------------------------------------
    // /compact threshold <percent>
    // ------------------------------------------------------------------
    case 'threshold': {
      const raw = parts[1]
      if (!raw) {
        return {
          kind: 'error',
          text: 'Usage: /compact threshold <percent>  (e.g. /compact threshold 85)',
        }
      }

      const parsed = parseFloat(raw)
      if (isNaN(parsed) || parsed < 1 || parsed > 99) {
        return {
          kind: 'error',
          text: `Invalid threshold "${raw}". Provide a number between 1 and 99.`,
        }
      }

      const fraction = parsed / 100
      ctx.manager.setCompactThreshold(fraction)

      return {
        kind: 'threshold_set',
        text: `Auto-compact threshold set to ${parsed}%.`,
      }
    }

    // ------------------------------------------------------------------
    // Unknown / help
    // ------------------------------------------------------------------
    default: {
      const helpText = [
        'Usage:',
        '  /compact status              - Show current context window usage',
        '  /compact now                 - Force compaction immediately',
        '  /compact threshold <percent> - Set auto-compact threshold (1-99)',
      ].join('\n')

      if (subcommand && subcommand !== 'help') {
        return {
          kind: 'error',
          text: `Unknown subcommand "${subcommand}".\n\n${helpText}`,
        }
      }

      return { kind: 'help', text: helpText }
    }
  }
}
