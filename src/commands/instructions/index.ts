import type { Command } from '../../commands.js'

const instructions = {
  type: 'local',
  name: 'instructions',
  description:
    'Show the currently merged layered instructions (global → workspace → local)',
  supportsNonInteractive: true,
  load: () => import('./instructions.js'),
} satisfies Command

export default instructions
