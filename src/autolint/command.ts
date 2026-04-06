/**
 * /autolint slash command — auto-lint and auto-test after edits.
 */

import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import type { LocalCommandResult } from '../types/command.js'
import { getAutoLintTestManager } from './index.js'

export async function call(
  args: string,
  _context: ToolUseContext,
): Promise<LocalCommandResult> {
  const manager = getAutoLintTestManager()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase() ?? ''

  // ---- enable / disable ---------------------------------------------------

  if (sub === 'enable') {
    manager.enable()
    return { type: 'text', value: 'Auto-lint/test enabled.' }
  }

  if (sub === 'disable') {
    manager.disable()
    return { type: 'text', value: 'Auto-lint/test disabled.' }
  }

  // ---- lint [files...] ----------------------------------------------------

  if (sub === 'lint') {
    const files = parts.slice(1).filter(Boolean)
    const result = manager.runLint(files.length > 0 ? files : undefined)
    const lines = [`Lint ${result.success ? 'PASSED' : 'FAILED'}`]
    if (result.errors.length > 0) {
      lines.push(`${result.errors.length} issue(s):`)
      for (const err of result.errors) {
        lines.push(`  ${err.file}:${err.line}:${err.col} ${err.severity}: ${err.message}`)
      }
    }
    if (!result.success || result.errors.length === 0) {
      lines.push('', result.rawOutput)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  // ---- test ---------------------------------------------------------------

  if (sub === 'test') {
    const result = manager.runTests()
    const lines = [
      `Tests ${result.success ? 'PASSED' : 'FAILED'}`,
      `Passed: ${result.passed} | Failed: ${result.failed}`,
    ]
    if (result.errors.length > 0) {
      lines.push('Errors:')
      for (const e of result.errors) {
        lines.push(`  ${e}`)
      }
    }
    if (!result.success) {
      lines.push('', result.rawOutput)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  // ---- run [files...] — both lint + test ----------------------------------

  if (sub === 'run') {
    const files = parts.slice(1).filter(Boolean)
    const { lint, test } = manager.runAll(files.length > 0 ? files : undefined)
    const lines: string[] = []

    lines.push(`Lint: ${lint.success ? 'PASSED' : 'FAILED'}`)
    if (lint.errors.length > 0) {
      lines.push(`  ${lint.errors.length} issue(s):`)
      for (const err of lint.errors) {
        lines.push(`    ${err.file}:${err.line}:${err.col} ${err.severity}: ${err.message}`)
      }
    }

    lines.push(`Tests: ${test.success ? 'PASSED' : 'FAILED'} (passed: ${test.passed}, failed: ${test.failed})`)
    if (test.errors.length > 0) {
      for (const e of test.errors) {
        lines.push(`  ${e}`)
      }
    }

    return { type: 'text', value: lines.join('\n') }
  }

  // ---- config <key> <value> -----------------------------------------------

  if (sub === 'config') {
    const key = parts[1]?.toLowerCase() ?? ''
    const value = parts.slice(2).join(' ')

    if (key === 'lint-cmd') {
      if (!value) return { type: 'text', value: 'Usage: /autolint config lint-cmd <cmd>' }
      manager.configure({ lintCmd: value })
      return { type: 'text', value: `Lint command set to: ${value}` }
    }

    if (key === 'test-cmd') {
      if (!value) return { type: 'text', value: 'Usage: /autolint config test-cmd <cmd>' }
      manager.configure({ testCmd: value })
      return { type: 'text', value: `Test command set to: ${value}` }
    }

    if (key === 'retries') {
      const n = parseInt(value, 10)
      if (isNaN(n) || n < 0) return { type: 'text', value: 'Usage: /autolint config retries <n> (non-negative integer)' }
      manager.configure({ maxRetries: n })
      return { type: 'text', value: `Max retries set to: ${n}` }
    }

    return {
      type: 'text',
      value: 'Available config keys:\n  lint-cmd <cmd>  — set lint command\n  test-cmd <cmd>  — set test command\n  retries <n>     — set max retries',
    }
  }

  // ---- stats --------------------------------------------------------------

  if (sub === 'stats') {
    const s = manager.getStats()
    const lines = [
      'Auto-lint/test statistics:',
      `  Lint runs:    ${s.lintRuns}`,
      `  Test runs:    ${s.testRuns}`,
      `  Auto-fixes:   ${s.autoFixCount}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  // ---- default: show status -----------------------------------------------

  const config = manager.getConfig()
  const stats = manager.getStats()
  const lines = [
    'Auto-lint/test configuration:',
    `  Enabled:      ${config.enabled ? 'yes' : 'no'}`,
    `  Lint cmd:     ${config.lintCmd || '(auto-detect)'}`,
    `  Test cmd:     ${config.testCmd || '(auto-detect)'}`,
    `  Auto-fix:     ${config.autoFix ? 'yes' : 'no'}`,
    `  Max retries:  ${config.maxRetries}`,
    '',
    'Session statistics:',
    `  Lint runs:    ${stats.lintRuns}`,
    `  Test runs:    ${stats.testRuns}`,
    `  Auto-fixes:   ${stats.autoFixCount}`,
    '',
    'Subcommands: enable | disable | lint [files] | test | run [files] | config | stats',
  ]
  return { type: 'text', value: lines.join('\n') }
}

const autolint = {
  type: 'local',
  name: 'autolint',
  description: 'Auto-lint and auto-test after edits',
  argumentHint: '<enable|disable|lint|test|run|config|stats> [args]',
  isEnabled: () => true,
  supportsNonInteractive: false,
  isHidden: false,
  load: () => import('./command.js'),
} satisfies Command

export default autolint
