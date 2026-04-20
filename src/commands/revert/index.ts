/**
 * /revert command — soft-delete messages after a given anchor, or
 * restore them with --restore.
 *
 * Destructive-feeling, so the command prompts for confirmation unless
 * the user passes --yes.
 *
 * Consumes `revertSession()` from src/services/session/api.ts (PR #58)
 * and `restoreSession()` from src/services/session/restore.ts (thin
 * additive helper for the --restore flag).
 *
 * Usage:
 *   /revert                    — revert to the last user message (with prompt)
 *   /revert <messageId>        — revert to the given anchor
 *   /revert <messageId> --yes  — skip the confirmation prompt
 *   /revert <messageId> --restore  — un-revert messages after anchor
 */
import type { Command } from '../../commands.js'

const revert = {
  type: 'local',
  name: 'revert',
  description:
    'Soft-delete messages after an anchor (or --restore to un-revert)',
  aliases: [],
  argumentHint: '[messageId] [--restore] [--yes]',
  supportsNonInteractive: true,
  load: () => import('./revert.js'),
} satisfies Command

export default revert
