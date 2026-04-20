/**
 * /fork command — create a new session branched from a message in the
 * current session.
 *
 * Consumes `forkSession()` from src/services/session/api.ts (PR #58).
 * Gated behind VOID_USE_SQLITE_SESSIONS=1 so the legacy JSON session
 * store stays the default until the feature flag is flipped.
 *
 * Usage:
 *   /fork             — fork from the last user message
 *   /fork <messageId> — fork from the specified message
 */
import type { Command } from '../../commands.js'

const fork = {
  type: 'local',
  name: 'fork',
  description:
    'Fork the current session from a message into a new child session',
  aliases: [],
  argumentHint: '[messageId]',
  supportsNonInteractive: false,
  load: () => import('./fork.js'),
} satisfies Command

export default fork
