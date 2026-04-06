/**
 * /repomap slash command — view AST-based codebase map.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getRepoMapManager } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const manager = getRepoMapManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  if (sub === 'refresh') {
    const map = manager.refresh()
    const stats = manager.getStats()
    return {
      type: 'text',
      value: `Repo map regenerated (${stats.files} files, ${stats.symbols} symbols).\n\n${map}`,
    }
  }

  if (sub === 'stats') {
    const stats = manager.getStats()
    if (stats.cacheAge < 0) {
      return {
        type: 'text',
        value: 'No repo map cached. Run /repomap to generate one.',
      }
    }
    const ageSeconds = (stats.cacheAge / 1000).toFixed(1)
    const lines = [
      'Repo map statistics:',
      `  Files:     ${stats.files}`,
      `  Symbols:   ${stats.symbols}`,
      `  Cache age: ${ageSeconds}s`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'budget') {
    const n = parseInt(parts[1] ?? '', 10)
    if (isNaN(n) || n <= 0) {
      return { type: 'text', value: 'Usage: /repomap budget <n>  (set max output lines)' }
    }
    manager.setTokenBudget(n)
    return { type: 'text', value: `Token budget set to ${n} lines.` }
  }

  // Default: show the current repo map
  const root = process.cwd()
  const map = manager.generateMap(root)
  if (!map) {
    return { type: 'text', value: 'No code files found in the current directory.' }
  }
  return { type: 'text', value: map }
}

const repomap = {
  type: 'local',
  name: 'repomap',
  description: 'View AST-based codebase map',
  argumentHint: '<refresh|stats|budget> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default repomap
