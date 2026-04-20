import type { Command } from '../../commands.js'

/**
 * Hidden slash command: /uncompact
 *
 * Rolls back the most recent auto-compaction by restoring the stashed
 * pre-compaction messages. Not listed in the palette; discoverable only
 * by typing it. Mirrors the pairing shown in docs/autoCompaction.md.
 */
const uncompact = {
  type: 'local',
  name: 'uncompact',
  description: 'Restore pre-compaction messages (undo the last auto-compact).',
  isEnabled: () => true,
  isHidden: true,
  supportsNonInteractive: true,
  load: () => import('./uncompact.js'),
} satisfies Command

export default uncompact
