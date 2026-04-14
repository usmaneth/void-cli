import type { Command } from '../../commands.js'

const deliberate = {
  type: 'local-jsx',
  name: 'deliberate',
  description:
    'Start a multi-model deliberation room — models debate a topic across rounds',
  argumentHint: '<topic> [--models m1,m2] [--rounds N] [--duo]',
  isHidden: false,
  load: () => import('./deliberate.js'),
} satisfies Command

export default deliberate
