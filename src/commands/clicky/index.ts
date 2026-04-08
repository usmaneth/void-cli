/**
 * Clicky command - manages the Clicky macOS app as a companion process.
 * Implementation is lazy-loaded from clicky.ts to reduce startup time.
 */
import type { Command } from '../../types/command.js'

const clicky = {
  type: 'local',
  name: 'clicky',
  description:
    'Manage the Clicky macOS app (start, stop, status, logs)',
  isHidden: false,
  argumentHint: '[start|stop|status|logs]',
  supportsNonInteractive: true,
  load: () => import('./clicky.js'),
} satisfies Command

export default clicky
