import type { Command } from '../../commands.js'

const provider = {
  type: 'local',
  name: 'provider',
  description: 'Manage API providers (OpenRouter, Anthropic)',
  argumentHint: '[list|add|remove|status] [provider]',
  supportsNonInteractive: true,
  load: () => import('./provider.js'),
} satisfies Command

export default provider
