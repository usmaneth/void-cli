import type { Command } from '../../commands.js'

const diagnose = {
  type: 'local',
  name: 'diagnose',
  description: 'Scan Void modules and report their status',
  supportsNonInteractive: true,
  load: () => import('./diagnose.js'),
} satisfies Command

export default diagnose
