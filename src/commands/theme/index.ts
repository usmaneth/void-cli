import type { Command } from '../../commands.js'

const theme = {
  type: 'local',
  name: 'theme',
  description: 'List and switch themes',
  supportsNonInteractive: true,
  argumentHint: '[list | current | set <name>]',
  load: () => import('./themeCommand.js'),
} satisfies Command

export default theme
