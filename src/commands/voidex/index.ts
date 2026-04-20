import type { Command } from '../../types/command.js'

const voidex = {
  type: 'local-jsx',
  name: 'voidex',
  aliases: ['vx'],
  description:
    "Open Voidex — Void's desktop app (Electron). Opens a window for chat/swarm/deliberate/plan.",
  argumentHint: '[prompt] [--mode chat|swarm|deliberate|plan] [--model <model>]',
  isHidden: false,
  load: () => import('./voidex.js'),
} satisfies Command

export default voidex
