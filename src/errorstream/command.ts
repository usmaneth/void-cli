/**
 * Slash command handler for /errors.
 *
 * Subcommands:
 *   /errors           — show recent errors (last 20)
 *   /errors all       — show all errors in history
 *   /errors stats     — show error statistics
 *   /errors clear     — clear error history
 *   /errors patterns  — list all registered patterns
 *   /errors add <regex> <severity> — add a custom pattern
 */
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getErrorStreamManager } from './index.js'
import type { ErrorSeverity } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const manager = getErrorStreamManager()

  const parts = args.trim().split(/\s+/)
  const subcommand = (parts[0] || '').toLowerCase()
  const rest = parts.slice(1)

  switch (subcommand) {
    case '':
      return { type: 'text', value: handleRecent(20) }

    case 'all':
      return { type: 'text', value: handleRecent(100) }

    case 'stats':
      return { type: 'text', value: handleStats() }

    case 'clear':
      return { type: 'text', value: handleClear() }

    case 'patterns':
      return { type: 'text', value: handlePatterns() }

    case 'add':
      return { type: 'text', value: handleAdd(rest) }

    default:
      return {
        type: 'text',
        value: [
          `Unknown subcommand: ${subcommand}`,
          '',
          'Usage:',
          '  /errors              Show recent errors (last 20)',
          '  /errors all          Show all errors in history',
          '  /errors stats        Show error statistics',
          '  /errors clear        Clear error history',
          '  /errors patterns     List all registered patterns',
          '  /errors add <regex> <severity>  Add a custom pattern',
        ].join('\n'),
      }
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function handleRecent(limit: number): string {
  const manager = getErrorStreamManager()
  const errors = manager.getRecentErrors(limit)

  if (errors.length === 0) {
    return 'No errors detected yet.'
  }

  const lines: string[] = [`Showing ${errors.length} recent error(s):`, '']

  for (const err of errors) {
    lines.push(manager.formatError(err))
    const suggestion = manager.getSuggestion(err)
    if (suggestion) {
      lines.push(`  \x1b[2mSuggestion: ${suggestion}\x1b[0m`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

function handleStats(): string {
  const manager = getErrorStreamManager()
  const stats = manager.getErrorStats()

  if (stats.total === 0) {
    return 'No errors recorded. Statistics are empty.'
  }

  const lines: string[] = [
    'Error Statistics',
    '================',
    '',
    `Total errors: ${stats.total}`,
    '',
    'By severity:',
    `  error:   ${stats.bySeverity.error}`,
    `  warning: ${stats.bySeverity.warning}`,
    `  info:    ${stats.bySeverity.info}`,
    '',
    'By language:',
  ]

  const langEntries = Object.entries(stats.byLanguage).sort(
    (a, b) => b[1] - a[1],
  )
  for (const [lang, count] of langEntries) {
    lines.push(`  ${lang}: ${count}`)
  }

  return lines.join('\n')
}

function handleClear(): string {
  const manager = getErrorStreamManager()
  const stats = manager.getErrorStats()
  const count = stats.total
  manager.clearErrors()
  return `Cleared ${count} error(s) from history.`
}

function handlePatterns(): string {
  const manager = getErrorStreamManager()
  const patterns = manager.getPatterns()

  const lines: string[] = [`Registered patterns (${patterns.length}):`, '']

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i]!
    const tags: string[] = []
    if (p.language) tags.push(p.language)
    if (p.framework) tags.push(p.framework)
    const tagStr = tags.length > 0 ? ` [${tags.join('/')}]` : ''
    lines.push(`  ${String(i).padStart(3)}  ${p.severity.padEnd(7)}  ${p.pattern.source}${tagStr}`)
  }

  return lines.join('\n')
}

function handleAdd(args: string[]): string {
  if (args.length < 2) {
    return 'Usage: /errors add <regex> <error|warning|info>'
  }

  const regexStr = args[0]!
  const severity = args[1]!.toLowerCase()

  if (severity !== 'error' && severity !== 'warning' && severity !== 'info') {
    return `Invalid severity "${args[1]}". Must be one of: error, warning, info`
  }

  let regex: RegExp
  try {
    regex = new RegExp(regexStr)
  } catch {
    return `Invalid regex: ${regexStr}`
  }

  const manager = getErrorStreamManager()
  manager.addPattern({
    pattern: regex,
    severity: severity as ErrorSeverity,
  })

  return `Added pattern: /${regexStr}/ with severity "${severity}"`
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

import type { Command } from '../commands.js'

const errors = {
  type: 'local',
  name: 'errors',
  description: 'Monitor and display real-time error detection',
  argumentHint: '<all|stats|clear|patterns|add> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  load: () => import('./command.js'),
} satisfies Command

export default errors
