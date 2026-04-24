import type { Command } from '../../commands.js'

const outline = {
  type: 'local-jsx',
  name: 'outline',
  description:
    'Show a compact outline of the current session — user prompts, tool activity, file edits, validation runs, and failures',
  load: () => import('./outline.js'),
} satisfies Command

export default outline
