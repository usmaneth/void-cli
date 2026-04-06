/**
 * /autocommit slash command — auto-commit with smart Conventional Commit messages.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getAutoCommitManager } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const manager = getAutoCommitManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  // -----------------------------------------------------------------------
  // /autocommit enable
  // -----------------------------------------------------------------------
  if (sub === 'enable') {
    manager.enable()
    return { type: 'text', value: 'Auto-commit enabled.' }
  }

  // -----------------------------------------------------------------------
  // /autocommit disable
  // -----------------------------------------------------------------------
  if (sub === 'disable') {
    manager.disable()
    return { type: 'text', value: 'Auto-commit disabled.' }
  }

  // -----------------------------------------------------------------------
  // /autocommit commit [files...]
  // -----------------------------------------------------------------------
  if (sub === 'commit') {
    const files = parts.slice(1)
    if (files.length === 0) {
      return { type: 'text', value: 'Usage: /autocommit commit <file1> [file2] ...' }
    }
    const result = manager.commit(files)
    if (result.success) {
      return {
        type: 'text',
        value: `Committed ${result.filesCommitted} file(s) as ${result.hash}: ${result.message}`,
      }
    }
    return { type: 'text', value: `Commit failed: ${result.message}` }
  }

  // -----------------------------------------------------------------------
  // /autocommit undo
  // -----------------------------------------------------------------------
  if (sub === 'undo') {
    const result = manager.undo()
    if (result.success) {
      return { type: 'text', value: `${result.message} (${result.hash})` }
    }
    return { type: 'text', value: `Undo failed: ${result.message}` }
  }

  // -----------------------------------------------------------------------
  // /autocommit history [n]
  // -----------------------------------------------------------------------
  if (sub === 'history') {
    const limit = parts[1] ? parseInt(parts[1], 10) : 10
    const entries = manager.getHistory(limit)
    if (entries.length === 0) {
      return { type: 'text', value: 'No auto-commits recorded yet.' }
    }
    const lines = entries.map(
      (e) => `${e.hash}  ${e.timestamp}  ${e.message}  [${e.files.join(', ')}]`,
    )
    return { type: 'text', value: lines.join('\n') }
  }

  // -----------------------------------------------------------------------
  // /autocommit config prefix <str>
  // /autocommit config author <str>
  // -----------------------------------------------------------------------
  if (sub === 'config') {
    const key = parts[1]?.toLowerCase()
    const value = parts.slice(2).join(' ')

    if (key === 'prefix') {
      manager.configure({ prefix: value })
      return { type: 'text', value: value ? `Commit prefix set to: ${value}` : 'Commit prefix cleared.' }
    }
    if (key === 'author') {
      manager.configure({ author: value || null })
      return { type: 'text', value: value ? `Commit author set to: ${value}` : 'Commit author cleared.' }
    }

    return { type: 'text', value: 'Usage: /autocommit config <prefix|author> <value>' }
  }

  // -----------------------------------------------------------------------
  // /autocommit stats
  // -----------------------------------------------------------------------
  if (sub === 'stats') {
    const stats = manager.getStats()
    const lines = [
      'Auto-commit Statistics',
      '----------------------',
      `Total commits: ${stats.totalCommits}`,
      `Undo count:    ${stats.undoCount}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  // -----------------------------------------------------------------------
  // Default: show status and current config
  // -----------------------------------------------------------------------
  const config = manager.getConfig()
  const lines = [
    'Auto-commit Status',
    '------------------',
    `Enabled:              ${config.enabled ? 'yes' : 'no'}`,
    `Conventional Commits: ${config.conventionalCommits ? 'yes' : 'no'}`,
    `Prefix:               ${config.prefix || '(none)'}`,
    `Author:               ${config.author || '(default)'}`,
    `Sign-off:             ${config.signoff ? 'yes' : 'no'}`,
  ]
  return { type: 'text', value: lines.join('\n') }
}

const autocommit = {
  type: 'local',
  name: 'autocommit',
  description: 'Auto-commit with smart Conventional Commit messages',
  argumentHint: '<enable|disable|commit|undo|history|config|stats> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default autocommit
