import type { Command } from '../../commands.js'

const handoff = {
  type: 'local-jsx',
  name: 'handoff',
  description:
    'Summarize the current session: changed files, validation commands, unresolved risks, and suggested next actions',
  load: () => import('./handoff.js'),
} satisfies Command

export default handoff
