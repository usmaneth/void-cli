import type { Command } from '../../commands.js'

const cmd = {
  type: 'prompt',
  name: 'cmd',
  description: 'Manage and run custom command templates',
  progressMessage: 'running custom command',
  contentLength: 0,
  source: 'builtin',
  argumentHint: '<list|run|create|edit|init> [name] [args...]',
  async getPromptForCommand(args) {
    const { handleCmdCommand } = await import('./command.js')
    const result = await handleCmdCommand(args)
    return [{ type: 'text', text: result }]
  },
} satisfies Command

export default cmd
