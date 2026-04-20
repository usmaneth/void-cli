import type { Command } from '../../commands.js'

/**
 * `/sessions` — full-screen session picker with live fuzzy search.
 * See `src/components/dialogs/SessionListDialog.tsx` for the renderer.
 */
const sessions: Command = {
  type: 'local-jsx',
  name: 'sessions',
  description: 'Browse and search saved conversations',
  argumentHint: '',
  load: () => import('./sessions.js'),
}

export default sessions
