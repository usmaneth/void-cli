import type { Command } from '../../commands.js'

const cockpit = {
  type: 'local-jsx',
  name: 'cockpit',
  description:
    'Session cockpit — outline, validation history, and handoff summary in one overlay',
  load: () => import('./cockpit.js'),
} satisfies Command

export default cockpit
