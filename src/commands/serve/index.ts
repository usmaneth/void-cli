import type { Command } from '../../commands.js'

const serve = {
  type: 'local',
  name: 'serve',
  description: 'Start/stop a headless HTTP server for CI/CD integration',
  argumentHint: '<start [port]|stop|status>',
  supportsNonInteractive: true,
  isEnabled: () => true,
  load: () => import('./command.js'),
} satisfies Command

export default serve
