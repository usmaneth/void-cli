import type { Command } from '../../types/command.js'

const voidex = {
  type: 'local-jsx',
  name: 'voidex',
  aliases: ['vx'],
  description:
    'Open Voidex — Void\u2019s Codex-style desktop chat app (spawns the Electron window)',
  argumentHint: '[prompt] [--mode chat|swarm|deliberate|plan] [--model <model>]',
  isHidden: false,
  load: () => import('./voidex.js'),
} satisfies Command

export default voidex
