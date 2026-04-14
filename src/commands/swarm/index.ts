import type { Command } from '../../commands.js'

const swarm = {
  type: 'local-jsx',
  name: 'swarm',
  description:
    'Multi-model parallel implementation — decompose, build in worktrees, merge',
  argumentHint: '<feature> [--models domain=model,...] [--no-merge] [--no-review]',
  isHidden: false,
  load: async () => {
    const mod = await import('./swarm.js')
    return { call: mod.call }
  },
} satisfies Command

export default swarm
