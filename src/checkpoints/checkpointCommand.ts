import type { Command } from '../commands.js'

const checkpoint = {
  type: 'local',
  name: 'checkpoint',
  description: 'Manage workspace checkpoints (list, diff, restore, prune)',
  argumentHint: '<list|diff|restore|prune> [id]',
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default checkpoint
